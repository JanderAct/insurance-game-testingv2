import React from 'react';
import { DollarSign, TrendingUp, BarChart2, Shield, RotateCcw, Lock, Info } from 'lucide-react';
import type { DecisionSet, LineDecisionSet, CoverageLine, LineView, LineResultSet } from '../types/simulation';
import SliderInput from '../components/SliderInput';
import AllocationBar from '../components/AllocationBar';
import { SLIDER_RANGES, REINSURANCE_PROGRAMS, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import { formatCurrency } from '../utils/formatters';
import { getReinsuranceStructure } from '../utils/reinsuranceEngine';
import { defaultLineDecisionSet } from '../utils/decisionDefaults';
import { lineDisplayName } from '../utils/lineDisplay';
import { lookupCLF } from '../utils/simulationEngine';
import type { FundingConsequence } from '../utils/fundingConsequence';

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
  // 'pool' hosts the two pool-wide decisions (investment allocation, risk
  // control); each coverage line's tab edits that line's own decisions.
  lineView: LineView;
  lineLoanInfo: Record<CoverageLine, LineLoanInfo>;
  // Last computed result for the line being edited — informational only
  // (excessCapitalRatio / capitalAdequacyStatus for the consequence panel).
  // Undefined only before the pre-game bootstrap has produced anything.
  lastLineResult?: LineResultSet;
  // Precomputed CLF-only pricing consequences for the line's CURRENTLY
  // SELECTED funding confidence level and reinsurance level. Null only
  // before a game exists.
  fundingConsequence: FundingConsequence | null;
}

// 0.30-0.45 ADDED alongside the funding-confidence range's extension down from
// 50%. 0.45 'Minimal' continues the existing descending scale; 0.40/0.35/0.30
// are named to read as unmistakably underfunded, since that is the point of
// making them selectable at all (see the consequence panel below).
// 0.60 is labeled 'Expected', not a rung on the confidence ladder like its
// neighbors — it is BOTH the default and the exact break-even/expected-loss
// funding point (CLF 1.000), so 'Below Average' made the intended setting
// read as a compromise rather than as the anchor it is. Sequence either side
// still reads sensibly: ...Moderate-Low (65%) -> Expected (60%) -> Low
// (55%)... — 'Expected' names a distinct concept (the funding-equals-expected
// point), not a step in the same relative gradation as its neighbors, so it
// does not need to fit that gradation.
const FUNDING_LEVEL_LABELS: Record<number, string> = {
  0.95: 'Maximum', 0.90: 'Very High', 0.85: 'High', 0.80: 'Above Average', 0.75: 'Balanced', 0.70: 'Moderate', 0.65: 'Moderate-Low', 0.60: 'Expected', 0.55: 'Low', 0.50: 'Very Low',
  0.45: 'Minimal', 0.40: 'Deficient', 0.35: 'Severely Deficient', 0.30: 'Critical',
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

export default function DecisionsPage({ decisions, onChange, yearNumber, estimatedPremium, estimatedExpectedLoss, disabled = false, lineView, lineLoanInfo, lastLineResult, fundingConsequence }: DecisionsPageProps) {
  // Pool tab: the two pool-wide decisions. One allocation policy and one
  // risk-control intensity for the whole pool — each line applies them to its
  // OWN base (own segregated portfolio / own premium).
  if (lineView === 'pool') {
    return <PoolDecisionsView decisions={decisions} onChange={onChange} yearNumber={yearNumber} disabled={disabled} />;
  }

  // Stage 2.7: every active line's remaining decisions are edited on its own
  // tab, strict per-line (Model A) — no cross-line "apply to all".
  const selectedLine: CoverageLine = lineView;
  const d = decisions.byLine[selectedLine];
  const selectedLoanInfo = lineLoanInfo[selectedLine];

  const set = (key: keyof LineDecisionSet, val: number | LineDecisionSet['assetAllocation']) =>
    onChange({ ...decisions, byLine: { ...decisions.byLine, [selectedLine]: { ...d, [key]: val } } });

  const reinsStructure = getReinsuranceStructure(d.reinsuranceLevel, estimatedPremium, estimatedExpectedLoss);
  const prog = REINSURANCE_PROGRAMS[d.reinsuranceLevel];
  const reinsCostPct = prog ? (prog.costPctOfPremiumMin + prog.costPctOfPremiumMax) / 2 : 0;
  const reinsCost = estimatedPremium * reinsCostPct;

  // COMBINED DIVIDEND/ASSESSMENT CONTROL (Part 1). One slider, zero at centre:
  // positive is a dividend, negative is an assessment. dividendPct and
  // assessmentPct stay separate engine fields — setting one always zeros the
  // other, which is what makes both-in-one-year structurally impossible where
  // the engine previously permitted it. Assessments remain OUTSIDE
  // totalMemberCharge in the engine (unchanged) — folding them in would
  // improve the loss ratio for the very members being billed.
  const dividendAssessmentValue = d.dividendPct > 0 ? d.dividendPct : -d.assessmentPct;
  const setDividendAssessment = (v: number) => {
    onChange({
      ...decisions,
      byLine: {
        ...decisions.byLine,
        [selectedLine]: {
          ...d,
          dividendPct: v > 0 ? v : 0,
          assessmentPct: v < 0 ? -v : 0,
        },
      },
    });
  };
  const dividendAssessmentDisplay = (v: number) => {
    if (v > 0.0001) return `Dividend ${(v * 100).toFixed(1)}%`;
    if (v < -0.0001) return `Assessment ${(-v * 100).toFixed(1)}%`;
    return 'None';
  };
  // Dividend side clamped to 0 while blocked (negative surplus carried in);
  // the assessment side stays fully available, unlike disabling the whole
  // control would allow.
  const dividendAssessmentMax = selectedLoanInfo.dividendBlocked ? 0 : SLIDER_RANGES.dividendAssessment.max;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Year {yearNumber} Decisions — {lineDisplayName(lineView)}</h2>
          <p className="text-gray-500 text-sm">Configure this line's strategy for the year</p>
        </div>
        {!disabled && (
          <button onClick={() => onChange(resetLineToDefaults(decisions, selectedLine))} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
            <RotateCcw size={14} /> Reset {lineDisplayName(selectedLine)} to Defaults
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Pricing & Funding" icon={<DollarSign size={16} />}>
          {/* Rate Change REMOVED — CLF-only pricing. Funding Confidence Level
              is now the sole pricing lever; the consequence panel below
              replaces the information the deleted lever used to carry. */}
          <SliderInput label="Funding Confidence Level" value={d.fundingConfidenceLevel} min={SLIDER_RANGES.fundingConfidenceLevel.min} max={SLIDER_RANGES.fundingConfidenceLevel.max} step={SLIDER_RANGES.fundingConfidenceLevel.step} onChange={v => set('fundingConfidenceLevel', v)} formatValue={v => `${getFundingLabel(v)} (${(v * 100).toFixed(0)}%)`} leftLabel="Underfunded" rightLabel="Higher Confidence" valueColor={d.fundingConfidenceLevel < 0.60 ? 'text-red-600' : 'text-gray-700'} disabled={disabled} helpText="Sets the reserve confidence level, applied as a multiplier (CLF) on expected losses. 60% is break-even; below it the pool is charging less than expected losses by design." />
          <FundingConsequencePanel c={fundingConsequence} lastLineResult={lastLineResult} />
          <SliderInput label="Dividend / Assessment" value={dividendAssessmentValue} min={SLIDER_RANGES.dividendAssessment.min} max={dividendAssessmentMax} step={SLIDER_RANGES.dividendAssessment.step} onChange={setDividendAssessment} formatValue={dividendAssessmentDisplay} leftLabel="Assessment" rightLabel="Dividend" valueColor={dividendAssessmentValue > 0 ? 'text-emerald-600' : dividendAssessmentValue < 0 ? 'text-red-600' : 'text-gray-500'} disabled={disabled} helpText="One combined control: positive returns value to members as a dividend; negative calls additional funds beyond premium as an assessment. Exactly one may apply in a given year — this is structural, not a suggestion. Assessments are never counted toward the loss ratio of the members being billed." />
          {selectedLoanInfo.dividendBlocked && (
            <p className="text-xs text-red-600 -mt-3">Dividend blocked: this line carried a negative surplus in from last year.</p>
          )}
        </SectionCard>

        <SectionCard title="Growth & Underwriting" icon={<TrendingUp size={16} />}>
          <SliderInput label="Underwriting Strictness" value={d.underwritingStrictness} min={SLIDER_RANGES.underwritingStrictness.min} max={SLIDER_RANGES.underwritingStrictness.max} step={SLIDER_RANGES.underwritingStrictness.step} onChange={v => set('underwritingStrictness', v)} formatValue={v => `${v}/10 — ${UW_LABELS[Math.round(v)]}`} leftLabel="Flexible" rightLabel="Strict" disabled={disabled} helpText="Strict underwriting improves risk quality." />
          <p className="flex items-start gap-1 text-[11px] text-gray-500 leading-relaxed -mt-3">
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            This is the current, active mechanism. It will be replaced by Renewal Underwriting and New Business Appetite (below) once member loss history exists.
          </p>
          <RenewalUnderwritingPreview />
        </SectionCard>

        {/* Full width — matches the Reinsurance Level box pattern below it, and
            full width is what guarantees five boxes stay on one row rather than
            cramming into a half-width column. (Reinsurance Program itself is
            currently ALSO half-width, not full-page as might be assumed from a
            glance at the rendered page — measured at 674px, identical to
            Growth & Underwriting's column. This card is given full width on its
            own merits, not by matching what Reinsurance currently does.) */}
        <div className="lg:col-span-2">
          <NewBusinessAppetitePreview />
        </div>

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
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <DataRow label="Attachment Point" value={formatCurrency(reinsStructure.attachment)} />
                <DataRow label="Attachment (% of Exp. Loss)" value={`${(REINSURANCE_PROGRAMS[0].attachmentMultiplierOfExpectedLoss * 100).toFixed(0)}%`} />
                <DataRow label="Self-Funded Amount" value={`${formatCurrency(estimatedPremium * REINSURANCE_PROGRAMS[4].costPctOfPremiumMax)}/yr`} />
                <p className="col-span-2 text-gray-500 italic mt-1">No external reinsurance — the pool retains all losses up to 125% of expected loss. Instead of paying the self-funded amount to a reinsurer, it stays in the pool's cash and earns investment income for the pool's own account.</p>
              </div>
            )}
            <p className="text-blue-700 mt-2 text-xs leading-relaxed border-t border-blue-100 pt-2">Reinsurance does not reduce gross losses. Above the attachment point, the reinsurer pays its quota share of the excess; the pool retains the rest.</p>
          </div>
        </SectionCard>

      </div>
    </div>
  );
}

// Pool tab: the two pool-wide decisions. Portfolios remain segregated per
// line (Stage 2.9) — every line applies this one allocation policy to its own
// invested assets, and the one risk-control intensity to its own premium.
function PoolDecisionsView({ decisions, onChange, yearNumber, disabled }: {
  decisions: DecisionSet;
  onChange: (d: DecisionSet) => void;
  yearNumber: number;
  disabled: boolean;
}) {
  const pctDisplay = (v: number) => `${(v * 100).toFixed(1)}%`;
  const resetPool = () => onChange({
    ...decisions,
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
  });

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Year {yearNumber} Decisions — Pool</h2>
          <p className="text-gray-500 text-sm">Pool-wide policies applied by every line to its own base</p>
        </div>
        {!disabled && (
          <button onClick={resetPool} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
            <RotateCcw size={14} /> Reset Pool to Defaults
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Investment Allocation" icon={<BarChart2 size={16} />}>
          <AllocationBar
            value={decisions.assetAllocation}
            onChange={allocation => onChange({ ...decisions, assetAllocation: allocation })}
            disabled={disabled}
          />
        </SectionCard>

        <SectionCard title="Loss Prevention" icon={<TrendingUp size={16} />}>
          <SliderInput
            label="Risk Control Investment"
            value={decisions.riskControlPct}
            min={SLIDER_RANGES.riskControlPct.min} max={SLIDER_RANGES.riskControlPct.max} step={SLIDER_RANGES.riskControlPct.step}
            onChange={v => onChange({ ...decisions, riskControlPct: v })}
            formatValue={pctDisplay} leftLabel="Low" rightLabel="High"
            valueColor={decisions.riskControlPct > 0.03 ? 'text-emerald-600' : 'text-gray-600'}
            disabled={disabled}
            helpText="Investment in member safety and training, as a percentage of premium. Each line spends this percentage of its own premium and earns the loss reduction on its own book."
          />
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

// CLF-only pricing consequence panel (Part 2). Everything here is computed in
// src/utils/fundingConsequence.ts from the SAME formulas simulationEngine.ts
// actually prices with — this renders that object, it does not recompute it.
function FundingConsequencePanel({ c, lastLineResult }: { c: FundingConsequence | null; lastLineResult?: LineResultSet }) {
  if (!c) return null;
  const pct1 = (v: number) => `${v.toFixed(1)}%`;
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const reserveMarginCLF = lookupCLF(0.90);

  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs space-y-2 -mt-1">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <DataRow label="CLF Multiplier" value={`×${c.clf.toFixed(3)}`} />
        <DataRow label="Pool Premium Rate / $100" value={`$${c.poolPremiumRatePer100.toFixed(2)}`} />
        <DataRow label="Total Member Charge Rate / $100" value={`$${c.totalMemberChargeRatePer100.toFixed(2)}`} />
        <DataRow label="The Load (charge ÷ expected loss)" value={`${c.load.toFixed(2)}×`} />
        <DataRow label="Expected Combined Ratio" value={pct1(c.expectedCombinedRatio * 100)} />
        <DataRow
          label="Derived Rate Change vs Last Year"
          value={c.derivedRateChangePct === null ? 'N/A (no prior year)' : signed(c.derivedRateChangePct)}
        />
        <DataRow
          label="Marginal Cost of Next Step"
          value={c.isAtMax ? 'At maximum (95%)' : `${signed(c.marginalCostPct ?? 0)} pool premium`}
        />
      </div>

      <div className="border-t border-gray-200 pt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <DataRow label="Reserve Margin Standard (fixed)" value={`90% confidence, CLF ${reserveMarginCLF.toFixed(3)}`} />
        <DataRow
          label="Excess Capital Ratio (as of last year)"
          value={lastLineResult ? `${(lastLineResult.excessCapitalRatio ?? 0).toFixed(2)} (${lastLineResult.capitalAdequacyStatus})` : '—'}
        />
      </div>

      {c.isAdequate ? (
        <p className="text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-2.5 py-1.5 leading-relaxed">
          Adequate in ~{(c.confidenceLevel * 100).toFixed(0)}% of years; margin over expected {signed(c.marginPct)}.
        </p>
      ) : (
        <p className="text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 leading-relaxed font-medium">
          UNDERFUNDING — this funds only {pct1(c.fundedPct)} of expected losses; expected combined ratio {pct1(c.expectedCombinedRatio * 100)}.
        </p>
      )}
    </div>
  );
}

// Inactive marker (Part 3). Both new underwriting controls render but are
// deliberately NOT wired to anything — see the module comment on why.
function InactiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
      <Lock size={10} /> Inactive
    </span>
  );
}

// Wrapper that visually greys out an inactive preview control and attaches
// the "why" as persistent helper text, rather than only a hover tooltip — a
// control that LOOKS live but is not is the failure this exists to prevent.
function InactivePreview({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/70 p-3 space-y-2 opacity-80">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-600">{title}</span>
        <InactiveBadge />
      </div>
      <div className="pointer-events-none select-none grayscale-[35%]">{children}</div>
      <p className="flex items-start gap-1 text-[11px] text-gray-500 leading-relaxed">
        <Info size={12} className="mt-0.5 flex-shrink-0" />
        Activates once member loss history exists (Stage 4 of the marketplace-generation work).
      </p>
    </div>
  );
}

// Shared box-selection styling for both inactive previews below — the SAME
// visual pattern Reinsurance Level uses (bold title, short description
// beneath, selected box highlighted), rendered in a MUTED GREY palette
// instead of Reinsurance's blue. That palette difference is deliberate and is
// what keeps a highlighted box from reading as a live selection next to
// Reinsurance's real blue one: grey can never be mistaken for "currently
// chosen and in effect," which blue would be.
function PreviewBox({ title, description, selected }: { title: string; description: string; selected: boolean }) {
  return (
    <button
      type="button"
      disabled
      tabIndex={-1}
      className={`flex flex-col items-center p-2 rounded-lg border text-center transition-all text-xs cursor-not-allowed ${selected ? 'bg-gray-300 border-gray-400 text-gray-800 shadow-sm' : 'bg-white border-gray-200 text-gray-500'}`}
    >
      <span className="font-bold">{title}</span>
      <span className="text-xs opacity-75 mt-0.5 leading-tight hidden sm:block">{description}</span>
    </button>
  );
}

// RENEWAL UNDERWRITING (Part 3, top control) — inactive preview. Would screen
// on the EXPERIENCE MODIFIER (actual ÷ expected loss at the member's own class,
// exposure and risk quality), never a loss ratio: a prospect has no premium
// with the pool, so a loss ratio is undefined for it, while actual-over-
// expected is defined identically for members and prospects. Local,
// unpersisted state only — this control is not wired to LineDecisionSet or to
// anything else. Deliberately no threshold default: the sensible non-renew
// level depends on the modifier's distribution, which Stage 4 will report —
// the threshold input below reveals with no value and no placeholder number
// for the same reason, only when the second box is picked.
function RenewalUnderwritingPreview() {
  const [mode, setMode] = React.useState<'renewAll' | 'nonRenewThreshold'>('renewAll');
  return (
    <InactivePreview title="Renewal Underwriting">
      <div className="grid grid-cols-2 gap-1">
        <div onClick={() => setMode('renewAll')}>
          <PreviewBox title="Renew All" description="Renew all existing members" selected={mode === 'renewAll'} />
        </div>
        <div onClick={() => setMode('nonRenewThreshold')}>
          <PreviewBox title="Non-renew above" description="Decline members above a threshold experience modifier" selected={mode === 'nonRenewThreshold'} />
        </div>
      </div>
      {mode === 'nonRenewThreshold' && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-gray-500">Threshold (experience modifier):</span>
          <input
            type="text"
            disabled
            placeholder="not yet calibrated"
            className="flex-1 text-[11px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-400 placeholder:text-gray-400 cursor-not-allowed"
          />
        </div>
      )}
    </InactivePreview>
  );
}

// NEW BUSINESS APPETITE (Part 3) — inactive preview, same experience-modifier
// basis as Renewal Underwriting above. FULL WIDTH (see the call site): five
// boxes need more room than the half-width Growth & Underwriting column gives
// comfortably, and full width is what guarantees they stay on one row rather
// than wrapping, which would break the left-to-right selectivity reading.
const APPETITE_OPTIONS = [
  { title: 'Open', description: 'Accept all applicants' },
  { title: 'Broad', description: 'Accept average or better' },
  { title: 'Unchanged', description: 'Maintain current appetite' },
  { title: 'Selective', description: 'Accept good experience only' },
  { title: 'Strict', description: 'Accept excellent experience only' },
] as const;

function NewBusinessAppetitePreview() {
  // 'Unchanged' is the neutral middle option — a display choice only, since
  // the control does nothing; it is not a calibrated default the way a real
  // threshold would need to be.
  const [selected, setSelected] = React.useState<number>(2);
  return (
    <InactivePreview title="New Business Appetite">
      <div className="grid grid-cols-5 gap-1">
        {APPETITE_OPTIONS.map((opt, i) => (
          <div key={opt.title} onClick={() => setSelected(i)}>
            <PreviewBox title={opt.title} description={opt.description} selected={i === selected} />
          </div>
        ))}
      </div>
    </InactivePreview>
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
