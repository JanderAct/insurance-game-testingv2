import React from 'react';
import { DollarSign, TrendingUp, BarChart2, Shield, RotateCcw, Lock, Info } from 'lucide-react';
import type { DecisionSet, LineDecisionSet, CoverageLine, LineView, LineResultSet } from '../types/simulation';
import SliderInput from '../components/SliderInput';
import AllocationBar from '../components/AllocationBar';
import { SLIDER_RANGES, REINSURANCE_PROGRAMS, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import { formatCurrency } from '../utils/formatters';
import { getReinsuranceStructure } from '../utils/reinsuranceEngine';
import { defaultLineDecisionSet } from '../utils/decisionDefaults';
import { usesTower } from '../utils/reinsuranceDisplay';
import { AGG_ATTACHMENT_LEVELS, AGG_LIMIT_MULTIPLE, REINSURANCE_TOWER, TOWER_TOP } from '../data/reinsuranceTower';
import { layerPremium, expectedCededForLayer, normalizeLayersPlaced, occurrenceProgramCost, quoteAggregate } from '../utils/reinsuranceTower';
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
  // Active exposure for the line being edited, in EXPOSURE UNITS ($M of payroll
  // or TIV). The tower prices per $100 of exposure, so the control needs it.
  estimatedExposure: number;
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

export default function DecisionsPage({ decisions, onChange, yearNumber, estimatedPremium, estimatedExpectedLoss, estimatedExposure, disabled = false, lineView, lineLoanInfo, lastLineResult, fundingConsequence }: DecisionsPageProps) {
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

  const set = (key: keyof LineDecisionSet, val: number | boolean[] | LineDecisionSet['assetAllocation']) =>
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
          <SliderInput label="Funding Confidence Level" value={d.fundingConfidenceLevel} min={SLIDER_RANGES.fundingConfidenceLevel.min} max={SLIDER_RANGES.fundingConfidenceLevel.max} step={SLIDER_RANGES.fundingConfidenceLevel.step} onChange={v => set('fundingConfidenceLevel', v)} formatValue={v => `${getFundingLabel(v)} (${(v * 100).toFixed(0)}%)`} leftLabel="Underfunded" rightLabel="Higher Confidence" valueColor={d.fundingConfidenceLevel < 0.60 ? 'text-red-600' : 'text-gray-700'} disabled={disabled} helpText="Sets the funding confidence level, applied as a multiplier (CLF) on expected losses to set pool premium. 60% is expected — pool premium equals expected losses. Below it the pool funds less than expected losses by design." />
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
          <NewBusinessAppetitePreview />
        </SectionCard>

        {outstandingLoanSlider(d, set, selectedLoanInfo, disabled)}

        <SectionCard title="Reinsurance Program" icon={<Shield size={16} />}>
          {usesTower(selectedLine) ? (
            <TowerControls
              line={selectedLine}
              d={d}
              set={set}
              disabled={disabled}
              exposure={estimatedExposure}
              expectedLoss={estimatedExpectedLoss}
            />
          ) : (
          <>
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
          </>
          )}
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
// classes as the Reinsurance Level boxes (bold title, description beneath
// allowed to wrap, selected box filled blue with reversed-out text), so a
// selected preview box reads as "chosen" rather than "disabled." The
// distinction from a live Reinsurance box is carried entirely by the
// InactivePreview wrapper around these (dashed border, grayscale filter,
// opacity, pointer-events-none, INACTIVE badge) — not by a different color.
function PreviewBox({ title, description, selected }: { title: string; description: string; selected: boolean }) {
  return (
    <button
      type="button"
      disabled
      tabIndex={-1}
      className={`w-full h-full flex flex-col items-center p-2 rounded-lg border text-center transition-all text-xs cursor-not-allowed ${selected ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-600 border-gray-200'}`}
    >
      <span className="font-bold">{title}</span>
      <span className="text-xs opacity-75 mt-0.5 leading-tight">{description}</span>
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
  // Starts unselected — an inactive control has no active choice to show.
  const [mode, setMode] = React.useState<'renewAll' | 'nonRenewThreshold' | null>(null);
  return (
    <InactivePreview title="Renewal Underwriting">
      {/* min-h matches New Business Appetite's row below (measured 66px) —
          Renewal's two boxes are wider so their descriptions wrap less and
          would otherwise sit shorter than that row on their own content. */}
      <div className="grid grid-cols-2 gap-1 min-h-[66px]">
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
// basis as Renewal Underwriting above, and rendered directly beneath it in
// the same Growth & Underwriting card: both are one decision about pool
// membership (existing members vs. applicants) and belong in one place. Five
// boxes across a half-width column means each is roughly 120px with
// multi-line wrapped descriptions — deliberately not reduced to fewer
// columns or shortened text, since the left-to-right selectivity ordering is
// what makes the control readable.
const APPETITE_OPTIONS = [
  { title: 'Open', description: 'Accept all applicants' },
  { title: 'Broad', description: 'Accept average or better' },
  { title: 'Unchanged', description: 'Maintain current appetite' },
  { title: 'Selective', description: 'Accept good experience only' },
  { title: 'Strict', description: 'Accept excellent experience only' },
] as const;

function NewBusinessAppetitePreview() {
  // Starts unselected, matching Renewal Underwriting above it — an inactive
  // control has no active choice to show, and the sensible default depends
  // on the modifier distribution Stage 4 will report.
  const [selected, setSelected] = React.useState<number | null>(null);
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

// ===========================================================================
// PER-OCCURRENCE TOWER CONTROLS (WC and GL). Property keeps the level selector
// above — it legitimately still uses REINSURANCE_PROGRAMS.
//
// EVERY LAYER'S PRICE IS SHOWN, because the loading rising with attachment IS
// the mechanic. A player who cannot see that the $15M xs $10M layer costs 3.3x
// its expected loss while the working layer costs 1.9x has no basis for choosing
// between them, and the decision collapses into "buy everything".
//
// NO ORDERING CONSTRAINT. Any combination is allowed, including buying a higher
// layer while declining a lower one. A corridor retention is unusual in the
// market but real, and choosing which bands to keep is the point.
// ===========================================================================
function TowerControls({
  line, d, set, disabled, exposure, expectedLoss,
}: {
  line: CoverageLine;
  d: LineDecisionSet;
  set: (key: keyof LineDecisionSet, val: number | boolean[]) => void;
  disabled: boolean;
  exposure: number;
  expectedLoss: number;
}) {
  const layers = REINSURANCE_TOWER[line as 'WC' | 'GL'];
  const placed = normalizeLayersPlaced(line as 'WC' | 'GL', d.layersPlaced);
  const per100 = exposure * 10_000;

  const toggle = (i: number) => {
    if (disabled || !layers[i].purchasable) return;
    const next = [...placed];
    next[i] = !next[i];
    set('layersPlaced', next);
  };

  const occCost = occurrenceProgramCost(line as 'WC' | 'GL', placed, per100);
  // LIVE, not cached: the aggregate is re-quoted from the CURRENT placements on
  // every render, so declining a layer immediately raises its price. That
  // responsiveness is the whole reason the price is computed rather than stored —
  // without it, "decline everything and buy the aggregate" is free volatility
  // transfer.
  const aggQuote = line === 'WC' && d.aggregateStopLevel >= 0
    ? quoteAggregate(placed, exposure, expectedLoss, d.aggregateStopLevel)
    : null;
  const totalCost = occCost + (aggQuote?.premium ?? 0);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Occurrence Layers — Retention $1M
        </p>
        <div className="space-y-1.5">
          {layers.map((l, i) => {
            const price = layerPremium(line as 'WC' | 'GL', i, per100);
            const expected = expectedCededForLayer(line as 'WC' | 'GL', i, per100);
            const multiple = expected > 0 ? price / expected : 0;
            if (!l.purchasable) {
              return (
                <div key={l.name} className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-500">{l.name}</span>
                    <span className="text-gray-400 font-semibold uppercase text-xs tracking-wide">Not available</span>
                  </div>
                  <p className="text-gray-500 mt-1 leading-relaxed">
                    Defined but <strong>not purchasable</strong>. This layer covers multi-claim catastrophe
                    occurrences — one event injuring several workers. The model emits one claim per WC
                    occurrence, and a single catastrophic claim tops out near <strong>$15.51M</strong> present
                    value, so the mechanism it was designed for cannot reach it. Offering it at a price would
                    be selling cover that cannot pay.
                  </p>
                </div>
              );
            }
            return (
              <button
                key={l.name}
                disabled={disabled}
                onClick={() => toggle(i)}
                className={`w-full text-left rounded-lg border p-2.5 transition-all text-xs ${
                  placed[i]
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold">{l.name}</span>
                  <span className={`font-semibold ${placed[i] ? 'text-blue-100' : 'text-gray-500'}`}>
                    {placed[i] ? 'PLACED' : 'RETAINED'}
                  </span>
                </div>
                <div className={`flex justify-between mt-1 ${placed[i] ? 'text-blue-100' : 'text-gray-500'}`}>
                  <span>{formatCurrency(price)}/yr</span>
                  <span>{multiple.toFixed(2)}x expected loss</span>
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 italic mt-2 leading-relaxed">
          Any combination is allowed — including buying a higher layer while declining a lower one.
          A declined layer is simply retained. The cost multiple rises with attachment because the
          reinsurer charges for capital, not claims.
        </p>
      </div>

      {line === 'GL' && (
        <div className="bg-amber-50 rounded-lg p-3 border border-amber-200 text-xs">
          <p className="font-bold text-amber-900 mb-1">Nothing above {TOWER_TOP.GL / 1e6 === 25 ? '$25M' : '—'}</p>
          <p className="text-amber-800 leading-relaxed">
            Market capacity above $25M per occurrence is hard to find, so no layer is offered.
            <strong> The pool retains everything above it, unlimited.</strong> That band is this line's
            largest single exposure and cannot be transferred at any price — it is reported as
            "Retained Above Tower" on Results and Financial Statements.
          </p>
        </div>
      )}

      {line === 'WC' && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Aggregate Stop-Loss — total annual retained loss
          </p>
          <div className="grid grid-cols-4 gap-1">
            <button
              disabled={disabled}
              onClick={() => !disabled && set('aggregateStopLevel', -1)}
              className={`flex flex-col items-center p-2 rounded-lg border text-center transition-all text-xs ${
                d.aggregateStopLevel < 0
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className="font-bold">None</span>
            </button>
            {AGG_ATTACHMENT_LEVELS.map((mult, lv) => {
              const q = quoteAggregate(placed, exposure, expectedLoss, lv);
              return (
                <button
                  key={lv}
                  disabled={disabled}
                  onClick={() => !disabled && set('aggregateStopLevel', lv)}
                  className={`flex flex-col items-center p-2 rounded-lg border text-center transition-all text-xs ${
                    d.aggregateStopLevel === lv
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="font-bold">{(mult * 100).toFixed(0)}%</span>
                  <span className="text-xs opacity-75 mt-0.5">{formatCurrency(q.premium)}</span>
                </button>
              );
            })}
          </div>
          {aggQuote && (
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              <DataRow label="Attaches At" value={formatCurrency(aggQuote.attachment)} />
              <DataRow label="Limit" value={`${formatCurrency(aggQuote.limit)} (${(AGG_LIMIT_MULTIPLE * 100).toFixed(0)}% of exp. retained)`} />
              <DataRow label="Expected Retained Loss" value={formatCurrency(aggQuote.expectedRetained)} />
              <DataRow label="Expected Recovery" value={`${formatCurrency(aggQuote.expectedCeded)}/yr`} />
            </div>
          )}
          <p className="text-xs text-gray-500 italic mt-2 leading-relaxed">
            Covers total annual retained loss — <strong>including loss retained through layers you
            declined</strong>. Its price is re-quoted live from your layer choices: declining occurrence
            layers puts large claims back into the retention, raising volatility and so raising this cost.
          </p>
        </div>
      )}

      <div className="bg-blue-50 rounded-lg p-3 border border-blue-200 text-xs">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <DataRow label="Occurrence Layers" value={`${formatCurrency(occCost)}/yr`} />
          {/* WC ONLY. Showing "Not purchased" on GL would imply an aggregate is
              available to decline, and none is offered — see the capacity note. */}
          {line === 'WC' && (
            <DataRow label="Aggregate Stop-Loss" value={aggQuote ? `${formatCurrency(aggQuote.premium)}/yr` : 'Not purchased'} />
          )}
          <DataRow label="Total Reinsurance Cost" value={`${formatCurrency(totalCost)}/yr`} />
          <DataRow label="Retained Above Tower" value={`Above ${TOWER_TOP[line as 'WC' | 'GL'] / 1e6}M — unlimited`} />
        </div>
        <p className="text-blue-700 mt-2 text-xs leading-relaxed border-t border-blue-200 pt-2">
          Priced as expected ceded loss plus a risk load, per $100 of exposure — <strong>not</strong> as a
          percentage of premium, so the cost no longer moves when you change the funding confidence level.
        </p>
      </div>
    </div>
  );
}
