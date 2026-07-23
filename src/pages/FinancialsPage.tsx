import React, { useState } from 'react';
import { FileText, Target } from 'lucide-react';
import type { LineResultSet, LineView } from '../types/simulation';
import { deriveAnnualStatement } from '../utils/financialStatementEngine';
import { formatCurrency, formatPct, colorForNetIncome } from '../utils/formatters';
import { lineDisplayName } from '../utils/lineDisplay';

interface FinancialsPageProps {
  lockedResults: LineResultSet[];
  // Stage 2.10: the pre-game years are REAL engine results (yearNumbers -2..0,
  // already filtered to the current view), so they get full real statements
  // through the same deriveAnnualStatement path as locked years.
  priorResults: LineResultSet[];
  lineView: LineView;
}

function formatYearEndDate(calendarYear: number): string {
  const yy = String(calendarYear % 100).padStart(2, '0');
  return `12/31/${yy}`;
}

export default function FinancialsPage({ lockedResults, priorResults, lineView }: FinancialsPageProps) {
  // Chronological order: earliest pre-game year first, Year 0 (the opening
  // position) last among the "prior" entries, then Year 1 onward below it.
  const openingYear = priorResults[priorResults.length - 1];
  const earlierPriorYears = priorResults.slice(0, -1);

  const [selectedIdx, setSelectedIdx] = useState<number>(openingYear?.yearNumber ?? 0);

  const yearOptions: { label: string; value: number }[] = [
    ...earlierPriorYears.map(y => ({ label: `${formatYearEndDate(y.calendarYear)} (History)`, value: y.yearNumber })),
    ...(openingYear ? [{ label: `Year 0 — ${formatYearEndDate(openingYear.calendarYear)} (Opening)`, value: openingYear.yearNumber }] : []),
    ...lockedResults.map(r => ({ label: `Year ${r.yearNumber} — ${formatYearEndDate(r.calendarYear)}`, value: r.yearNumber })),
  ];

  const isOpening = !!openingYear && selectedIdx === openingYear.yearNumber;
  const selectedResult = selectedIdx > 0
    ? lockedResults.find(r => r.yearNumber === selectedIdx)
    : priorResults.find(r => r.yearNumber === selectedIdx);
  const statement = selectedResult ? deriveAnnualStatement(selectedResult) : null;
  const isLiveYear = selectedIdx > 0;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Financial Statements{lineView !== 'pool' ? ` — ${lineDisplayName(lineView)}` : ''}</h2>
          <p className="text-gray-500 text-sm">Select a year to view the full statement</p>
        </div>
        <select value={String(selectedIdx)} onChange={e => setSelectedIdx(parseInt(e.target.value))} className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          {yearOptions.map(opt => (<option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>))}
        </select>
      </div>

      {statement && (
        <div className="space-y-5">
          <SectionHeader
            title={`Financial Statements — ${isLiveYear ? `Year ${statement.yearNumber}` : isOpening ? 'Year 0 (Opening)' : 'History'} — ${formatYearEndDate(statement.calendarYear)}`}
            subtitle={isLiveYear ? `Locked results for Year ${statement.yearNumber}` : isOpening ? 'Opening position — the last simulated pre-game year; its ending balance sheet is the Year 1 opening' : 'Simulated pre-game year (read-only, default decisions)'}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <StatementCard title="Income Statement">
              <ISLine label="Pool Premium" value={formatCurrency(statement.incomeStatement.poolPremium)} />
              <ISLine label="Admin Expense" value={formatCurrency(statement.incomeStatement.adminExpense)} />
              <ISLine label="Pool Premium & Admin Expense" value={formatCurrency(statement.incomeStatement.poolPremiumAndAdminExpense)} />
              <ISLine label="Reinsurance Cost" value={formatCurrency(statement.incomeStatement.reinsuranceCost)} />
              <ISLine label="Self-Funded Discount" value={`(${formatCurrency(statement.incomeStatement.selfFundedDiscount)})`} valueColor="text-emerald-600" />
              <ISLine label="Gross Premium & Admin Expense" value={formatCurrency(statement.incomeStatement.totalMemberCharge)} bold />
              <ISLine label="Assessments" value={formatCurrency(statement.incomeStatement.assessments)} />
              <div className="border-t border-gray-200 my-2" />
              <ISLine label="Ultimate Losses" value={formatCurrency(statement.incomeStatement.grossUltimateLoss)} />
              <ISLine label="Pool Losses" value={formatCurrency(statement.incomeStatement.poolLosses)} />
              <ISLine label="Excess Losses" value={formatCurrency(statement.incomeStatement.excessLosses)} />
              <ISLine label="Quota Share Losses" value={formatCurrency(statement.incomeStatement.quotaShareLosses)} />
              <ISLine label="Reinsurance Losses" value={formatCurrency(statement.incomeStatement.reinsuranceRecovery)} />
              <ISLine label="Net Ultimate Loss" value={formatCurrency(statement.incomeStatement.netUltimateLoss)} />
              <div className="border-t border-gray-200 my-2" />
              <ISLine label="Net Incurred Loss" value={`(${formatCurrency(statement.incomeStatement.netIncurredLoss)})`} valueColor="text-red-600" />
              <ISLine label="Admin Expense" value={`(${formatCurrency(statement.incomeStatement.operatingExpense)})`} valueColor="text-red-600" />
              <ISLine label="Risk Control Investment" value={`(${formatCurrency(statement.incomeStatement.riskControlInvestment)})`} valueColor="text-red-600" />
              <ISLine label="Reinsurance Cost" value={`(${formatCurrency(statement.incomeStatement.reinsuranceCost)})`} valueColor="text-red-600" />
              <ISLine label="Dividends / Returned Pool Premium" value={`(${formatCurrency(statement.incomeStatement.dividends)})`} valueColor="text-red-600" />
              {selectedResult && (
                <p className="text-xs text-gray-400 -mt-1">Includes prior-year reserve development: {formatCurrency(statement.incomeStatement.priorYearDevelopment)} ({statement.incomeStatement.priorYearDevelopment >= 0 ? 'favorable' : 'adverse'})</p>
              )}
              <div className="border-t border-gray-200 my-2" />
              <ISLine label="Underwriting Income" value={formatCurrency(statement.incomeStatement.underwritingIncome)} bold valueColor={colorForNetIncome(statement.incomeStatement.underwritingIncome)} />
              <ISLine label="Investment Income" value={formatCurrency(statement.incomeStatement.investmentIncome)} valueColor={statement.incomeStatement.investmentIncome >= 0 ? 'text-emerald-600' : 'text-red-600'} />
              <div className="border-t border-gray-200 my-2" />
              <ISLine label="Net Income" value={formatCurrency(statement.incomeStatement.netIncome)} bold valueColor={colorForNetIncome(statement.incomeStatement.netIncome)} />
            </StatementCard>
            <StatementCard title="Ending Balance Sheet">
              <BSLine label="Cash & Cash Equivalents" value={formatCurrency(statement.balanceSheet.cash)} />
              <BSLine label="Investments" value={formatCurrency(statement.balanceSheet.investments)} />
              <BSLine label="Reinsurance Recoverable on Unpaid Losses" value={formatCurrency(statement.balanceSheet.reinsuranceRecoverable)} />
              <BSLine label="Other Assets" value={formatCurrency(statement.balanceSheet.otherAssets)} />
              <BSLine label="Total Assets" value={formatCurrency(statement.balanceSheet.totalAssets)} bold />
              <div className="border-t border-gray-200 my-2" />
              <BSLine label="Gross Unpaid Loss and LAE Reserve" value={formatCurrency(statement.balanceSheet.grossUnpaidReserve)} />
              <BSLine label="Unearned Pool Premium" value={formatCurrency(statement.balanceSheet.unearnedPremium)} />
              <BSLine label="Other Liabilities" value={formatCurrency(statement.balanceSheet.otherLiabilities)} />
              <BSLine label="Total Liabilities" value={formatCurrency(statement.balanceSheet.totalLiabilities)} bold />
              <div className="border-t border-gray-200 my-2" />
              <BSLine label="Net Equity / Surplus" value={formatCurrency(statement.balanceSheet.surplus)} bold highlight valueColor={statement.balanceSheet.surplus >= 0 ? 'text-emerald-700' : 'text-red-700'} />
              <p className="text-xs text-gray-400 mt-2">Balance check: Assets ({formatCurrency(statement.balanceSheet.totalAssets)}) − Liabilities ({formatCurrency(statement.balanceSheet.totalLiabilities)}) = {formatCurrency(statement.balanceSheet.surplus)}</p>
              {selectedResult && (
                <p className="text-xs text-gray-500 mt-1 italic">Gross Unpaid Reserve represents expected unpaid losses, not a CLF-loaded funding target.</p>
              )}
            </StatementCard>
            <StatementCard title="Net Equity / Surplus Rollforward">
              <BSLine label="Beginning Net Equity / Surplus" value={formatCurrency(statement.surplusRollforward.beginingSurplus)} />
              <BSLine label="Net Income" value={formatCurrency(statement.surplusRollforward.netIncome)} valueColor={colorForNetIncome(statement.surplusRollforward.netIncome)} />
              <div className="border-t border-gray-200 my-2" />
              <BSLine label="= Surplus from Income" value={formatCurrency(statement.surplusRollforward.surplusFromIncome)} />
              <BSLine label="Ending Net Equity / Surplus (Balance Sheet)" value={formatCurrency(statement.surplusRollforward.endingSurplus)} bold highlight valueColor={statement.surplusRollforward.endingSurplus >= 0 ? 'text-emerald-700' : 'text-red-700'} />
              {selectedResult && (
                <>
                  <BSLine label="Tie-Out Difference" value={formatCurrency(statement.surplusRollforward.tieOutDifference)} valueColor={Math.abs(statement.surplusRollforward.tieOutDifference) < 100 ? 'text-emerald-600' : 'text-amber-600'} />
                  {Math.abs(statement.surplusRollforward.tieOutDifference) >= 100 && (
                    <p className="text-xs text-amber-600 mt-1">Note: Tie-out difference may indicate prior-year reserve adjustments or other non-income items.</p>
                  )}
                </>
              )}
            </StatementCard>

            {/* Funding Target & Adequacy — only applies to played years; historical years have no player-selected funding confidence */}
            {statement.fundingDetail && (
              <StatementCard title="Funding Target & Adequacy" icon={<Target size={16} className="text-blue-600" />}>
                <MetricRow label="Expected Net Unpaid Loss" value={formatCurrency(statement.fundingDetail.expectedNetUnpaidLoss)} />
                <MetricRow label="Selected Funding Confidence" value={formatPct(statement.fundingDetail.selectedFundingConfidenceLevel, 0)} valueColor="text-blue-600" />
                <MetricRow label="CLF Applied" value={statement.fundingDetail.selectedFundingCLF.toFixed(3)} />
                <div className="border-t border-gray-100 my-2" />
                <MetricRow label="Required Reserve Margin" value={formatCurrency(statement.fundingDetail.requiredReserveMargin)} valueColor="text-amber-600" />
                <div className="border-t border-gray-100 my-2" />
                <MetricRow label="Surplus" value={formatCurrency(statement.fundingDetail.availableFunding)} />
                <MetricRow label="Excess Available Surplus" value={formatCurrency(statement.fundingDetail.excessAvailableSurplus)} valueColor={statement.fundingDetail.excessAvailableSurplus >= 0 ? 'text-emerald-600' : 'text-red-600'} />
                <MetricRow label="Excess Capital Ratio" value={statement.fundingDetail.excessCapitalRatio === null ? 'N/A' : formatPct(statement.fundingDetail.excessCapitalRatio)} />
                <MetricRow label="Excess Capital Status" value={statement.fundingDetail.excessCapitalStatus} valueColor={
                  statement.fundingDetail.excessCapitalStatus === 'Strong' ? 'text-emerald-600' :
                  statement.fundingDetail.excessCapitalStatus === 'Adequate' ? 'text-emerald-600' :
                  statement.fundingDetail.excessCapitalStatus === 'Thin' ? 'text-amber-600' :
                  'text-red-600'
                } />
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  Funding confidence level is used to evaluate funding adequacy, not to book the accounting reserve. Higher confidence requires more capital cushion.
                </p>
              </StatementCard>
            )}

            <StatementCard title="Reinsurance Detail">
              <MetricRow label="Protection Level" value={`${statement.reinsuranceDetail.level} — ${statement.reinsuranceDetail.levelLabel}`} />
              <MetricRow label="Attachment Point" value={formatCurrency(statement.reinsuranceDetail.attachment)} />
              <MetricRow label="Reinsurance Cost" value={formatCurrency(statement.reinsuranceDetail.reinsuranceCost)} />
              <MetricRow label="Gross Ultimate Loss + LAE" value={formatCurrency(statement.reinsuranceDetail.grossLoss)} />
              <MetricRow label="Reinsurance Losses" value={formatCurrency(statement.reinsuranceDetail.reinsuranceRecovery)} />
              <MetricRow label="Net Ultimate Loss + LAE" value={formatCurrency(statement.reinsuranceDetail.netLoss)} />
              <MetricRow label="Cession Ratio" value={formatPct(statement.reinsuranceDetail.cessionRatio)} />
              <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2 mt-2">Reinsurance losses reduce net retained losses but do not reduce gross losses.</p>
            </StatementCard>
          </div>
        </div>
      )}

      {!statement && (
        <div className="text-center py-16 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>No statement available. Lock a year to generate statements.</p>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-blue-100 rounded-lg p-2 flex-shrink-0">
        <FileText size={18} className="text-blue-600" />
      </div>
      <div>
        <h3 className="font-bold text-gray-900">{title}</h3>
        <p className="text-gray-500 text-sm">{subtitle}</p>
      </div>
    </div>
  );
}

function StatementCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 bg-gray-50/60 border-b border-gray-200 flex items-center gap-2">
        {icon}
        <h4 className="font-bold text-gray-800 text-sm">{title}</h4>
      </div>
      <div className="p-5 space-y-1.5">{children}</div>
    </div>
  );
}

function BSLine({ label, value, bold, highlight, valueColor = 'text-gray-800' }: { label: string; value: string; bold?: boolean; highlight?: boolean; valueColor?: string }) {
  return (
    <div className={`flex justify-between items-baseline gap-2 ${highlight ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
      <span className={`text-sm text-gray-600 ${bold ? 'font-semibold text-gray-800' : ''}`}>{label}</span>
      <span className={`text-sm font-mono ${bold ? 'font-bold' : 'font-medium'} ${valueColor} text-right`}>{value}</span>
    </div>
  );
}

function ISLine({ label, value, bold, valueColor = 'text-gray-800' }: { label: string; value: string; bold?: boolean; valueColor?: string }) {
  return BSLine({ label, value, bold, valueColor });
}

function MetricRow({ label, value, valueColor = 'text-gray-800' }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between items-center gap-2 py-0.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-semibold ${valueColor}`}>{value}</span>
    </div>
  );
}
