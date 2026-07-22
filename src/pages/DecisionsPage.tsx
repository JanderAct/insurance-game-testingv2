import React from 'react';
import { DollarSign, TrendingUp, BarChart2, Shield, RotateCcw, ClipboardList } from 'lucide-react';
import type { DecisionSet, LineDecisionSet, CoverageLine } from '../types/simulation';
import SliderInput from '../components/SliderInput';
import { SLIDER_RANGES, REINSURANCE_PROGRAMS, FULL_TRANSFER_COST_PCT_OF_PREMIUM, SELF_FUNDED_DISCOUNT_PCT, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import { formatCurrency } from '../utils/formatters';
import { getReinsuranceStructure } from '../utils/reinsuranceEngine';

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

function defaultDecisions(yearNumber: number): DecisionSet {
  // Fresh object per line (allocation is nested, so lines must not share a reference).
  const lineDefaults = () => ({
    rateChange: SLIDER_RANGES.rateChange.default,
    fundingConfidenceLevel: SLIDER_RANGES.fundingConfidenceLevel.default,
    dividendPct: SLIDER_RANGES.dividendPct.default,
    assessmentPct: SLIDER_RANGES.assessmentPct.default,
    underwritingStrictness: SLIDER_RANGES.underwritingStrictness.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    reinsuranceLevel: SLIDER_RANGES.reinsuranceLevel.default,
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    loanRepaymentAggressiveness: 0.5,
  });
  return {
    yearNumber,
    byLine: {
      WC: lineDefaults(),
      GL: lineDefaults(),
      Property: lineDefaults(),
    },
  };
}

export default function DecisionsPage({ decisions, onChange, yearNumber, estimatedPremium, estimatedExpectedLoss, disabled = false, lineView, lineLoanInfo }: DecisionsPageProps) {
  // WC is the only line with real per-line decision editing today (full
  // per-line editing is Stage 2.7, a later stage).
  const editableLine: CoverageLine = 'WC';
  const isEditableView = lineView === editableLine;
  const selectedLine: CoverageLine = lineView;
  const selectedLineDecisions = decisions.byLine[selectedLine];
  const selectedLoanInfo = lineLoanInfo[selectedLine];

  const wc = decisions.byLine.WC;
  const set = (key: keyof LineDecisionSet, val: number | LineDecisionSet['assetAllocation']) =>
    onChange({ ...decisions, byLine: { ...decisions.byLine, WC: { ...wc, [key]: val } } });

  // Stage 2.9: allocation is a per-line decision — these sliders edit WC's own
  // portfolio (GL/Property run on fixed defaults until Stage 2.7).
  const { cashPct, bondsPct } = wc.assetAllocation;
  const equitiesPct = Math.max(0, 100 - cashPct - bondsPct);
  const setCashPct = (val: number) =>
    set('assetAllocation', { cashPct: val, bondsPct: Math.min(bondsPct, 100 - val), equitiesPct: Math.max(0, 100 - val - Math.min(bondsPct, 100 - val)) });
  const setBondsPct = (val: number) =>
    set('assetAllocation', { cashPct: Math.min(cashPct, 100 - val), bondsPct: val, equitiesPct: Math.max(0, 100 - val - Math.min(cashPct, 100 - val)) });

  const reinsStructure = getReinsuranceStructure(wc.reinsuranceLevel, estimatedPremium, estimatedExpectedLoss);
  const prog = REINSURANCE_PROGRAMS[wc.reinsuranceLevel];
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
        {!disabled && isEditableView && (
          <button onClick={() => onChange(defaultDecisions(yearNumber))} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
            <RotateCcw size={14} /> Reset to Defaults
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {isEditableView ? (
          <>
            <SectionCard title="Pricing & Funding" icon={<DollarSign size={16} />}>
              <SliderInput label="Rate Change" value={wc.rateChange} min={SLIDER_RANGES.rateChange.min} max={SLIDER_RANGES.rateChange.max} step={SLIDER_RANGES.rateChange.step} onChange={v => set('rateChange', v)} formatValue={rateDisplay} leftLabel="Decrease" rightLabel="Increase" valueColor={wc.rateChange > 0.05 ? 'text-amber-600' : wc.rateChange < -0.05 ? 'text-blue-600' : 'text-gray-700'} disabled={disabled} helpText="Higher rates improve premium adequacy but reduce member retention." />
              <SliderInput label="Funding Confidence Level" value={wc.fundingConfidenceLevel} min={SLIDER_RANGES.fundingConfidenceLevel.min} max={SLIDER_RANGES.fundingConfidenceLevel.max} step={SLIDER_RANGES.fundingConfidenceLevel.step} onChange={v => set('fundingConfidenceLevel', v)} formatValue={v => `${getFundingLabel(v)} (${(v * 100).toFixed(0)}%)`} leftLabel="Lower Confidence" rightLabel="Higher Confidence" disabled={disabled} helpText="Sets the reserve confidence level. Higher levels strengthen the balance sheet." />
              <SliderInput label="Dividend / Return of Pool Premium" value={wc.dividendPct} min={SLIDER_RANGES.dividendPct.min} max={SLIDER_RANGES.dividendPct.max} step={SLIDER_RANGES.dividendPct.step} onChange={v => set('dividendPct', v)} formatValue={pctDisplay} leftLabel="None" rightLabel="High" valueColor={wc.dividendPct > 0 ? 'text-emerald-600' : 'text-gray-500'} disabled={disabled || lineLoanInfo.WC.dividendBlocked} helpText="Returns value to members." />
              {lineLoanInfo.WC.dividendBlocked && (
                <p className="text-xs text-red-600 -mt-3">Dividend blocked: this line carried a negative surplus in from last year.</p>
              )}
              <SliderInput label="Assessment" value={wc.assessmentPct} min={SLIDER_RANGES.assessmentPct.min} max={SLIDER_RANGES.assessmentPct.max} step={SLIDER_RANGES.assessmentPct.step} onChange={v => set('assessmentPct', v)} formatValue={pctDisplay} leftLabel="None" rightLabel="High" valueColor={wc.assessmentPct > 0 ? 'text-red-600' : 'text-gray-500'} disabled={disabled} helpText="Additional calls on members beyond premium." />
            </SectionCard>

            <SectionCard title="Growth & Underwriting" icon={<TrendingUp size={16} />}>
              <SliderInput label="Underwriting Strictness" value={wc.underwritingStrictness} min={SLIDER_RANGES.underwritingStrictness.min} max={SLIDER_RANGES.underwritingStrictness.max} step={SLIDER_RANGES.underwritingStrictness.step} onChange={v => set('underwritingStrictness', v)} formatValue={v => `${v}/10 — ${UW_LABELS[Math.round(v)]}`} leftLabel="Flexible" rightLabel="Strict" disabled={disabled} helpText="Strict underwriting improves risk quality." />
              <SliderInput label="Risk Control Investment" value={wc.riskControlPct} min={SLIDER_RANGES.riskControlPct.min} max={SLIDER_RANGES.riskControlPct.max} step={SLIDER_RANGES.riskControlPct.step} onChange={v => set('riskControlPct', v)} formatValue={pctDisplay} leftLabel="Low" rightLabel="High" valueColor={wc.riskControlPct > 0.03 ? 'text-emerald-600' : 'text-gray-600'} disabled={disabled} helpText="Investment in member safety and training." />
            </SectionCard>

            {wcOutstandingLoanSlider(wc, set, lineLoanInfo.WC, disabled)}

            <SectionCard title="Reinsurance Program" icon={<Shield size={16} />}>
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Reinsurance Level</p>
                <div className="grid grid-cols-5 gap-1">
                  {REINSURANCE_PROGRAMS.map(prog => (
                    <button key={prog.level} disabled={disabled} onClick={() => !disabled && set('reinsuranceLevel', prog.level)} className={`flex flex-col items-center p-2 rounded-lg border text-center transition-all text-xs ${wc.reinsuranceLevel === prog.level ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                      <span className="font-bold">{prog.label}</span>
                      <span className="text-xs opacity-75 mt-0.5 leading-tight hidden sm:block">{prog.description}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs space-y-1">
                {wc.reinsuranceLevel > 0 ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <DataRow label="Attachment Point" value={formatCurrency(reinsStructure.attachment)} />
                    <DataRow label="Attachment (% of Exp. Loss)" value={`${(REINSURANCE_PROGRAMS[wc.reinsuranceLevel].attachmentMultiplierOfExpectedLoss * 100).toFixed(0)}%`} />
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
          </>
        ) : (
          <ReadOnlyLineDecisions line={selectedLine} lineDecisions={selectedLineDecisions} loanInfo={selectedLoanInfo} />
        )}

        <SectionCard title="Investment Allocation" icon={<BarChart2 size={16} />}>
          {isEditableView ? (
            <>
              <p className="text-xs text-gray-500 -mt-2">
                This allocation applies to the {lineView} line's own segregated investment portfolio — each line invests separately and keeps its own gains and losses.
              </p>
              <SliderInput label="Cash %" value={cashPct} min={0} max={100} step={1} onChange={setCashPct} formatValue={v => `${v.toFixed(0)}%`} leftLabel="None" rightLabel="All Cash" disabled={disabled} helpText="Low return, very low volatility." />
              <SliderInput label="Bonds %" value={bondsPct} min={0} max={100} step={1} onChange={setBondsPct} formatValue={v => `${v.toFixed(0)}%`} leftLabel="None" rightLabel="All Bonds" disabled={disabled} helpText="Moderate return, moderate volatility." />
              <div className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                <span className="text-sm text-gray-600">Equities % (remainder)</span>
                <span className="font-semibold text-gray-800">{equitiesPct.toFixed(0)}%</span>
              </div>
              <p className="text-xs text-gray-500">Higher expected return, higher volatility, with an occasional down year.</p>
            </>
          ) : (
            <>
              <p className="text-sm text-amber-700">
                Per-line editing for {lineView} isn't available yet — this line invests its own portfolio on the fixed default allocation below. Full per-line editing arrives in a later stage.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <DataRow label="Cash %" value={`${selectedLineDecisions.assetAllocation.cashPct.toFixed(0)}%`} />
                <DataRow label="Bonds %" value={`${selectedLineDecisions.assetAllocation.bondsPct.toFixed(0)}%`} />
                <DataRow label="Equities %" value={`${selectedLineDecisions.assetAllocation.equitiesPct.toFixed(0)}%`} />
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// The loan-repayment slider is only meaningful (and only editable) for WC
// today, and only while WC carries an outstanding balance.
function wcOutstandingLoanSlider(
  wc: LineDecisionSet,
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
        value={wc.loanRepaymentAggressiveness}
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

function ReadOnlyLineDecisions({ line, lineDecisions, loanInfo }: { line: CoverageLine; lineDecisions: LineDecisionSet; loanInfo: LineLoanInfo }) {
  const pctDisplay = (v: number) => `${(v * 100).toFixed(1)}%`;
  const rateDisplay = (v: number) => v >= 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`;
  const prog = REINSURANCE_PROGRAMS[lineDecisions.reinsuranceLevel];

  return (
    <SectionCard title={`${line} Decisions (Read-Only)`} icon={<ClipboardList size={16} />}>
      <p className="text-sm text-amber-700">
        Per-line decision editing for {line} isn't available yet — this line runs on fixed default decisions every year. Full per-line editing arrives in a later stage.
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <DataRow label="Rate Change" value={rateDisplay(lineDecisions.rateChange)} />
        <DataRow label="Funding Confidence Level" value={`${(lineDecisions.fundingConfidenceLevel * 100).toFixed(0)}%`} />
        <DataRow label="Dividend %" value={pctDisplay(lineDecisions.dividendPct)} />
        <DataRow label="Assessment %" value={pctDisplay(lineDecisions.assessmentPct)} />
        <DataRow label="Underwriting Strictness" value={`${lineDecisions.underwritingStrictness} / 10`} />
        <DataRow label="Risk Control %" value={pctDisplay(lineDecisions.riskControlPct)} />
        <DataRow label="Reinsurance Level" value={`${lineDecisions.reinsuranceLevel} — ${prog?.label ?? ''}`} />
      </div>
      {loanInfo.balance > 0 && (
        <div className="pt-3 border-t border-gray-100">
          <p className="text-sm text-amber-700">Outstanding inter-line loan: {formatCurrency(loanInfo.balance)}</p>
          <p className="text-xs text-gray-500 mt-1">
            Repaying at a fixed {(lineDecisions.loanRepaymentAggressiveness * 100).toFixed(0)}% of positive net income (not yet player-adjustable for this line).
          </p>
        </div>
      )}
      {loanInfo.dividendBlocked && (
        <p className="text-xs text-red-600">This line carried a negative surplus in from last year — its dividend is blocked.</p>
      )}
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
