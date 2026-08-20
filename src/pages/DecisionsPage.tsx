import React from 'react';
import { DollarSign, TrendingUp, BarChart2, Shield, RotateCcw, Lock, Info } from 'lucide-react';
import type { DecisionSet, LineDecisionSet, CoverageLine, LineView, LineResultSet, Member } from '../types/simulation';
import SliderInput from '../components/SliderInput';
import AllocationBar from '../components/AllocationBar';
import { SLIDER_RANGES, REINSURANCE_PROGRAMS, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import { formatCurrency } from '../utils/formatters';
import { getReinsuranceStructure } from '../utils/reinsuranceEngine';
import { defaultLineDecisionSet } from '../utils/decisionDefaults';
import { usesTower } from '../utils/reinsuranceDisplay';
import { AGG_ATTACHMENT_LEVELS, AGG_LIMIT_MULTIPLE, REINSURANCE_TOWER, RISK_LOAD_LAMBDA, TOWER_TOP } from '../data/reinsuranceTower';
import { normalizeLayersPlaced, quoteAggregate } from '../utils/reinsuranceTower';
import { allLayerRiskMoments } from '../utils/towerMoments';
import { lineDisplayName } from '../utils/lineDisplay';
import { lookupCLF } from '../utils/simulationEngine';
import { hasStaticClf, staticClf } from '../data/clfTables';
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
  // The line's ACTIVE enrolled members. The reinsurance tower prices off the
  // book itself now, not off a frozen per-$100 rate card times exposure — both
  // E[ceded] and SD[ceded] depend on who is actually enrolled and on the year.
  activeMembers: Member[];
}

// 0.30-0.45 ADDED alongside the funding-confidence range's extension down from
// 50%. 0.45 'Minimal' continues the existing descending scale; 0.40/0.35/0.30
// are named to read as unmistakably underfunded, since that is the point of
// making them selectable at all (see the consequence panel below).
// 0.60 is labeled 'Expected' HERE, for PROPERTY ONLY — it is BOTH Property's
// default and the exact break-even/expected-loss funding point in
// FUNDING_CLF_TABLE (CLF 1.000 there), so 'Below Average' made the intended
// setting read as a compromise rather than as the anchor it is. This map is
// no longer used by WC or GL: their own derived grids' break-even is NOT at
// 60% and moves with the book (see FUNDING_LEVEL_LABELS_LINE below and the
// fundingAtExpected field), so keeping the "0.60 = Expected" label there would
// mislabel the stop exactly the way the derived grids were built to prevent.
const FUNDING_LEVEL_LABELS: Record<number, string> = {
  0.95: 'Maximum', 0.90: 'Very High', 0.85: 'High', 0.80: 'Above Average', 0.75: 'Balanced', 0.70: 'Moderate', 0.65: 'Moderate-Low', 0.60: 'Expected', 0.55: 'Low', 0.50: 'Very Low',
  0.45: 'Minimal', 0.40: 'Deficient', 0.35: 'Severely Deficient', 0.30: 'Critical',
};

// WC and GL: the SAME descending gradation, minus the 60%='Expected' special
// case above — 'Expected' now names a book-dependent concept surfaced
// separately (fundingAtExpected), not a fixed rung at 60%. 0.60 reads as an
// ordinary point in the ladder here, same as 0.65 or 0.55.
const FUNDING_LEVEL_LABELS_LINE: Record<number, string> = {
  0.95: 'Maximum', 0.90: 'Very High', 0.85: 'High', 0.80: 'Above Average', 0.75: 'Balanced', 0.70: 'Moderate', 0.65: 'Moderate-Low', 0.60: 'Below Average', 0.55: 'Low', 0.50: 'Very Low',
  0.45: 'Minimal', 0.40: 'Deficient', 0.35: 'Severely Deficient', 0.30: 'Critical',
};

function getFundingLabel(v: number, labels: Record<number, string> = FUNDING_LEVEL_LABELS): string {
  const rounded = Math.round(v * 20) / 20;
  return labels[rounded] ?? v.toFixed(2);
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

export default function DecisionsPage({ decisions, onChange, yearNumber, estimatedPremium, estimatedExpectedLoss, disabled = false, lineView, lineLoanInfo, lastLineResult, fundingConsequence, activeMembers }: DecisionsPageProps) {
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

  const set = (key: keyof LineDecisionSet, val: number | boolean | boolean[] | LineDecisionSet['assetAllocation']) =>
    onChange({ ...decisions, byLine: { ...decisions.byLine, [selectedLine]: { ...d, [key]: val } } });

  // WC/GL ONLY: dragging the slider always exits Expected mode (a manual
  // percentile choice), landing exactly on the dragged value. Selecting
  // "Expected" back is the separate button rendered below the slider.
  const setFundingLevel = (v: number) =>
    onChange({ ...decisions, byLine: { ...decisions.byLine, [selectedLine]: { ...d, fundingConfidenceLevel: v, fundingAtExpected: false } } });
  const setFundingAtExpected = () => set('fundingAtExpected', true);

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
          <FundingLevelControl
            line={selectedLine}
            d={d}
            fundingConsequence={fundingConsequence}
            setFundingLevel={setFundingLevel}
            setFundingAtExpected={setFundingAtExpected}
            set={set}
            disabled={disabled}
          />
          <FundingConsequencePanel c={fundingConsequence} lastLineResult={lastLineResult} line={selectedLine} />
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
              expectedLoss={estimatedExpectedLoss}
              members={activeMembers}
              yearNumber={yearNumber}
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

// THE FUNDING CONFIDENCE LEVEL CONTROL. Property renders its ORIGINAL slider
// unchanged (0.60 already reads 'Expected' correctly there — see
// FUNDING_LEVEL_LABELS above). WC and GL get a second control: the native
// range input's thumb renders at whatever `value` it is given even when that
// value is not a multiple of `step` (only manual dragging snaps to the step
// grid), so while fundingAtExpected is true the slider's value is bound to
// fundingConsequence.expectedPercentile — the marker sits at its TRUE,
// book-dependent position on the track, labeled 'Expected (~X%)', without any
// custom slider component. Dragging the thumb calls setFundingLevel, which
// lands exactly on the dragged value AND clears fundingAtExpected in the same
// update — the natural, and only, way to leave Expected mode. A separate
// button re-selects Expected directly, since a dragged slider can never land
// back on an arbitrary fractional percentage on its own.
function FundingLevelControl({ line, d, fundingConsequence, setFundingLevel, setFundingAtExpected, set, disabled }: {
  line: CoverageLine;
  d: LineDecisionSet;
  fundingConsequence: FundingConsequence | null;
  setFundingLevel: (v: number) => void;
  setFundingAtExpected: () => void;
  set: (key: keyof LineDecisionSet, val: number) => void;
  disabled: boolean;
}) {
  if (line === 'Property') {
    return (
      <SliderInput
        label="Funding Confidence Level"
        value={d.fundingConfidenceLevel}
        min={SLIDER_RANGES.fundingConfidenceLevel.min} max={SLIDER_RANGES.fundingConfidenceLevel.max} step={SLIDER_RANGES.fundingConfidenceLevel.step}
        onChange={v => set('fundingConfidenceLevel', v)}
        formatValue={v => `${getFundingLabel(v)} (${(v * 100).toFixed(0)}%)`}
        leftLabel="Underfunded" rightLabel="Higher Confidence"
        valueColor={d.fundingConfidenceLevel < 0.60 ? 'text-red-600' : 'text-gray-700'}
        disabled={disabled}
        helpText="Sets the funding confidence level, applied as a multiplier (CLF) on expected losses to set pool premium. 60% is expected — pool premium equals expected losses. Below it the pool funds less than expected losses by design."
      />
    );
  }

  // WC/GL: break-even is not a fixed percent — it moves with the enrolled
  // book's own CV (WC) or expected claim count (GL). expectedPercentile is
  // cross-checked against the same grid computeWcClf/computeGlClf use (see
  // wcClfCrossingPercentile/glClfCrossingPercentile), never derived separately.
  const expectedPct = fundingConsequence?.expectedPercentile ?? d.fundingConfidenceLevel;
  const sliderValue = d.fundingAtExpected ? expectedPct : d.fundingConfidenceLevel;
  const isAdequate = !fundingConsequence || fundingConsequence.isAdequate;

  return (
    <div className="flex flex-col gap-1">
      <SliderInput
        label="Funding Confidence Level"
        value={sliderValue}
        min={SLIDER_RANGES.fundingConfidenceLevel.min} max={SLIDER_RANGES.fundingConfidenceLevel.max} step={SLIDER_RANGES.fundingConfidenceLevel.step}
        onChange={setFundingLevel}
        formatValue={v => d.fundingAtExpected ? `Expected (~${Math.round(v * 100)}%)` : `${getFundingLabel(v, FUNDING_LEVEL_LABELS_LINE)} (${(v * 100).toFixed(0)}%)`}
        leftLabel="Underfunded" rightLabel="Higher Confidence"
        valueColor={isAdequate ? 'text-gray-700' : 'text-red-600'}
        disabled={disabled}
        helpText="Sets the funding confidence level, applied as a multiplier (CLF) on expected losses to set pool premium. This line's break-even (CLF exactly 1.000) is not a fixed percent — it moves with the enrolled book's size and composition. 'Expected' tracks that true position directly; a percentile stop instead prices at that exact confidence level regardless of where break-even currently falls."
      />
      {!d.fundingAtExpected && (
        <button
          type="button"
          onClick={setFundingAtExpected}
          disabled={disabled}
          className="self-start text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed -mt-1"
        >
          Reset to Expected (~{Math.round(expectedPct * 100)}%)
        </button>
      )}
    </div>
  );
}

// CLF-only pricing consequence panel (Part 2). Everything here comes from
// src/utils/fundingConsequence.ts, which calls quoteLineRates — literally the
// same function simulationEngine calls to build its own quote. This renders
// that object; it does not recompute anything.
//
// ⚠ THE CLAIM ABOVE USED TO BE FALSE AND IS NOW ASSERTED. It previously said
// the panel used "the SAME formulas simulationEngine.ts actually prices with"
// while the panel funded GROSS and charged a percentage-of-premium
// reinsurance rate — GL's pool premium rate read $5.63 here against the
// engine's $3.26. It is kept only because parity is now structural (one shared
// function) AND checked component by component in
// scripts/diagnostics/panel-engine-parity-check.ts. If that check is ever
// deleted, delete this claim with it.
//
// ONE RESIDUAL, STATED: these are PRE-MOVEMENT figures. The engine settles the
// year's premium on the post-movement book, so the final rate differs by
// whoever joins or leaves — measured at a median 1.0% on WC, 3.2% on GL, 0.0%
// on Property. That is not closable: the panel is asked the question before the
// answer exists.
function FundingConsequencePanel({ c, lastLineResult, line }: { c: FundingConsequence | null; lastLineResult?: LineResultSet; line: CoverageLine }) {
  if (!c) return null;
  const pct1 = (v: number) => `${v.toFixed(1)}%`;
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  // PER LINE, mirroring simulationEngine's reserveMarginCLF dispatch. An
  // unconditional lookupCLF(0.90) here read 1.951 — Property's table — on every
  // line, against WC's actual 1.3709 and GL's 1.5020, i.e. the same
  // wrong-curve-on-the-display defect clfFor above this file was written to fix,
  // surviving in the one readout that did not go through it.
  const reserveMarginCLF = hasStaticClf(line) ? staticClf(line, 0.90) : lookupCLF(0.90);

  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs space-y-2 -mt-1">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <DataRow label="CLF Multiplier" value={`×${c.clf.toFixed(3)}`} />
        {/* The net-funding step, shown rather than hidden inside the pool
            premium rate: without it the panel's own numbers do not multiply
            out, which is what made the old gross derivation so hard to spot. */}
        <DataRow label="Pure Premium Rate / $100 (gross)" value={`$${c.purePremiumPer100.toFixed(2)}`} />
        {c.expectedCededPer100 > 0 && (
          <DataRow label="Less Expected Ceded / $100" value={`−$${c.expectedCededPer100.toFixed(2)}`} />
        )}
        {c.expectedCededPer100 > 0 && (
          <DataRow label="Net Pure Premium Rate / $100" value={`$${c.netPurePremiumPer100.toFixed(2)}`} />
        )}
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
  line, d, set, disabled, expectedLoss, members, yearNumber,
}: {
  line: CoverageLine;
  d: LineDecisionSet;
  set: (key: keyof LineDecisionSet, val: number | boolean[]) => void;
  disabled: boolean;
  expectedLoss: number;
  members: Member[];
  yearNumber: number;
}) {
  const layers = REINSURANCE_TOWER[line as 'WC' | 'GL'];
  const placed = normalizeLayersPlaced(line as 'WC' | 'GL', d.layersPlaced);

  const toggle = (i: number) => {
    if (disabled || !layers[i].purchasable) return;
    const next = [...placed];
    next[i] = !next[i];
    set('layersPlaced', next);
  };

  // One moment pass for the whole tower, reused by every row below — calling
  // layerPremium/expectedCededForLayer per row walked the book six times.
  const layerMoms = allLayerRiskMoments(line as 'WC' | 'GL', members, yearNumber);
  const occCost = layers.reduce((s, l, i) =>
    s + (placed[i] && l.purchasable ? layerMoms[i].expected + RISK_LOAD_LAMBDA * layerMoms[i].sd : 0), 0);
  // LIVE, not cached: the aggregate is re-quoted from the CURRENT placements on
  // every render, so declining a layer immediately raises its price. That
  // responsiveness is the whole reason the price is computed rather than stored —
  // without it, "decline everything and buy the aggregate" is free volatility
  // transfer.
  const aggQuote = line === 'WC' && d.aggregateStopLevel >= 0
    ? quoteAggregate(placed, members, expectedLoss, d.aggregateStopLevel, yearNumber)
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
            const price = layerMoms[i].expected + RISK_LOAD_LAMBDA * layerMoms[i].sd;
            const expected = layerMoms[i].expected;
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
              const q = quoteAggregate(placed, members, expectedLoss, lv, yearNumber);
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
          Priced as expected ceded loss plus a risk load on its standard deviation, both computed from
          <strong> your own book and this year's severity</strong> — not as a percentage of premium, so the
          cost does not move when you change the funding confidence level. A smaller book is more volatile
          per dollar of expected loss, so it pays a higher multiple for the same layer.
        </p>
      </div>
    </div>
  );
}
