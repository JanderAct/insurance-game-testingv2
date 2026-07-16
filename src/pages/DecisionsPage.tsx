import React from 'react';
import { DollarSign, TrendingUp, BarChart2, Shield, RotateCcw } from 'lucide-react';
import type { DecisionSet } from '../types/simulation';
import SliderInput from '../components/SliderInput';
import { SLIDER_RANGES, REINSURANCE_PROGRAMS } from '../data/defaultAssumptions';
import { formatCurrency } from '../utils/formatters';
import { getReinsuranceStructure } from '../utils/reinsuranceEngine';

interface DecisionsPageProps {
  decisions: DecisionSet;
  onChange: (d: DecisionSet) => void;
  yearNumber: number;
  estimatedPremium: number;
  estimatedExpectedLoss: number;
  disabled?: boolean;
}

const FUNDING_LEVEL_LABELS: Record<number, string> = {
  0.50: 'Very Low', 0.55: 'Low', 0.60: 'Below Average', 0.65: 'Moderate-Low', 0.70: 'Moderate', 0.75: 'Balanced', 0.80: 'Above Average', 0.85: 'High', 0.90: 'Very High', 0.95: 'Maximum',
};

function getFundingLabel(v: number): string {
  const rounded = Math.round(v * 20) / 20;
  return FUNDING_LEVEL_LABELS[rounded] ?? v.toFixed(2);
}

const UW_LABELS = ['Very Flexible', 'Flexible', 'Somewhat Flexible', 'Moderate-Flexible', 'Moderate', 'Moderate-Strict', 'Somewhat Strict', 'Strict', 'Very Strict', 'Extremely Strict', 'Maximum Strict'];
const INV_LABELS = ['Very Conservative', 'Conservative', 'Moderately Conservative', 'Moderate-Low', 'Balanced', 'Moderate-High', 'Moderately Aggressive', 'Aggressive', 'Very Aggressive', 'Highly Aggressive', 'Maximum Aggressive'];

function defaultDecisions(yearNumber: number): DecisionSet {
  return {
    yearNumber,
    rateChange: SLIDER_RANGES.rateChange.default,
    fundingConfidenceLevel: SLIDER_RANGES.fundingConfidenceLevel.default,
    dividendPct: SLIDER_RANGES.dividendPct.default,
    assessmentPct: SLIDER_RANGES.assessmentPct.default,
    underwritingStrictness: SLIDER_RANGES.underwritingStrictness.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    reinsuranceLevel: SLIDER_RANGES.reinsuranceLevel.default,
    investmentRisk: SLIDER_RANGES.investmentRisk.default,
  };
}

export default function DecisionsPage({ decisions, onChange, yearNumber, estimatedPremium, estimatedExpectedLoss, disabled = false }: DecisionsPageProps) {
  const set = (key: keyof DecisionSet, val: number) => onChange({ ...decisions, [key]: val });

  const reinsStructure = getReinsuranceStructure(decisions.reinsuranceLevel, estimatedPremium, estimatedExpectedLoss);
  const prog = REINSURANCE_PROGRAMS[decisions.reinsuranceLevel];
  const reinsCostPct = prog ? (prog.costPctOfPremiumMin + prog.costPctOfPremiumMax) / 2 : 0;
  const reinsCost = estimatedPremium * reinsCostPct;

  const rateDisplay = (v: number) => v >= 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`;
  const pctDisplay = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Year {yearNumber} Decisions</h2>
          <p className="text-gray-500 text-sm">Configure your pool's strategy for this year</p>
        </div>
        {!disabled && (
          <button onClick={() => onChange(defaultDecisions(yearNumber))} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
            <RotateCcw size={14} /> Reset to Defaults
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Pricing & Funding" icon={<DollarSign size={16} />}>
          <SliderInput label="Rate Change" value={decisions.rateChange} min={SLIDER_RANGES.rateChange.min} max={SLIDER_RANGES.rateChange.max} step={SLIDER_RANGES.rateChange.step} onChange={v => set('rateChange', v)} formatValue={rateDisplay} leftLabel="Decrease" rightLabel="Increase" valueColor={decisions.rateChange > 0.05 ? 'text-amber-600' : decisions.rateChange < -0.05 ? 'text-blue-600' : 'text-gray-700'} disabled={disabled} helpText="Higher rates improve premium adequacy but reduce member retention." />
          <SliderInput label="Funding Confidence Level" value={decisions.fundingConfidenceLevel} min={SLIDER_RANGES.fundingConfidenceLevel.min} max={SLIDER_RANGES.fundingConfidenceLevel.max} step={SLIDER_RANGES.fundingConfidenceLevel.step} onChange={v => set('fundingConfidenceLevel', v)} formatValue={v => `${getFundingLabel(v)} (${(v * 100).toFixed(0)}%)`} leftLabel="Lower Confidence" rightLabel="Higher Confidence" disabled={disabled} helpText="Sets the reserve confidence level. Higher levels strengthen the balance sheet." />
          <SliderInput label="Dividend / Return of Pool Premium" value={decisions.dividendPct} min={SLIDER_RANGES.dividendPct.min} max={SLIDER_RANGES.dividendPct.max} step={SLIDER_RANGES.dividendPct.step} onChange={v => set('dividendPct', v)} formatValue={pctDisplay} leftLabel="None" rightLabel="High" valueColor={decisions.dividendPct > 0 ? 'text-emerald-600' : 'text-gray-500'} disabled={disabled} helpText="Returns value to members." />
          <SliderInput label="Assessment" value={decisions.assessmentPct} min={SLIDER_RANGES.assessmentPct.min} max={SLIDER_RANGES.assessmentPct.max} step={SLIDER_RANGES.assessmentPct.step} onChange={v => set('assessmentPct', v)} formatValue={pctDisplay} leftLabel="None" rightLabel="High" valueColor={decisions.assessmentPct > 0 ? 'text-red-600' : 'text-gray-500'} disabled={disabled} helpText="Additional calls on members beyond premium." />
        </SectionCard>

        <SectionCard title="Growth & Underwriting" icon={<TrendingUp size={16} />}>
          <SliderInput label="Underwriting Strictness" value={decisions.underwritingStrictness} min={SLIDER_RANGES.underwritingStrictness.min} max={SLIDER_RANGES.underwritingStrictness.max} step={SLIDER_RANGES.underwritingStrictness.step} onChange={v => set('underwritingStrictness', v)} formatValue={v => `${v}/10 — ${UW_LABELS[Math.round(v)]}`} leftLabel="Flexible" rightLabel="Strict" disabled={disabled} helpText="Strict underwriting improves risk quality." />
          <SliderInput label="Risk Control Investment" value={decisions.riskControlPct} min={SLIDER_RANGES.riskControlPct.min} max={SLIDER_RANGES.riskControlPct.max} step={SLIDER_RANGES.riskControlPct.step} onChange={v => set('riskControlPct', v)} formatValue={pctDisplay} leftLabel="Low" rightLabel="High" valueColor={decisions.riskControlPct > 0.03 ? 'text-emerald-600' : 'text-gray-600'} disabled={disabled} helpText="Investment in member safety and training." />
        </SectionCard>

        <SectionCard title="Investment & Reserving" icon={<BarChart2 size={16} />}>
          <SliderInput label="Investment Risk" value={decisions.investmentRisk} min={SLIDER_RANGES.investmentRisk.min} max={SLIDER_RANGES.investmentRisk.max} step={SLIDER_RANGES.investmentRisk.step} onChange={v => set('investmentRisk', v)} formatValue={v => `${v}/10 — ${INV_LABELS[Math.round(v)]}`} leftLabel="Conservative" rightLabel="Aggressive" disabled={disabled} helpText="Higher investment risk increases expected returns but also surplus volatility." />
        </SectionCard>

        <SectionCard title="Reinsurance Program" icon={<Shield size={16} />}>
          <div className="mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Reinsurance Level</p>
            <div className="grid grid-cols-5 gap-1">
              {REINSURANCE_PROGRAMS.map(prog => (
                <button key={prog.level} disabled={disabled} onClick={() => !disabled && set('reinsuranceLevel', prog.level)} className={`flex flex-col items-center p-2 rounded-lg border text-center transition-all text-xs ${decisions.reinsuranceLevel === prog.level ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                  <span className="font-bold">{prog.label}</span>
                  <span className="text-xs opacity-75 mt-0.5 leading-tight hidden sm:block">{prog.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs space-y-1">
            {decisions.reinsuranceLevel > 0 ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <DataRow label="Attachment Point" value={formatCurrency(reinsStructure.attachment)} />
                <DataRow label="Attachment (% of Exp. Loss)" value={`${(REINSURANCE_PROGRAMS[decisions.reinsuranceLevel].attachmentMultiplierOfExpectedLoss * 100).toFixed(0)}%`} />
                <DataRow label="Quota Share %" value={`${(reinsStructure.recoveryPct * 100).toFixed(0)}%`} />
                <DataRow label="Coverage" value="Uncapped above attachment" />
                <DataRow label="Est. Annual Cost" value={`${formatCurrency(reinsCost)}/yr (${(reinsCostPct * 100).toFixed(0)}% of prem.)`} />
              </div>
            ) : (
              <p className="text-gray-500 italic">No reinsurance — pool retains all gross losses.</p>
            )}
            <p className="text-blue-700 mt-2 text-xs leading-relaxed border-t border-blue-100 pt-2">Reinsurance does not reduce gross losses. Above the attachment point, the reinsurer pays its quota share of the excess; the pool retains the rest.</p>
          </div>
        </SectionCard>
      </div>
    </div>
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
