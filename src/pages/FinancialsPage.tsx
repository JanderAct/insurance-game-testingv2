import React, { useState } from 'react';
import { FileText, Target } from 'lucide-react';
import type { CoverageLine, LineResultSet, LineView, ResultSet } from '../types/simulation';
import { deriveAnnualStatement } from '../utils/financialStatementEngine';
import { RETAINED_ABOVE_TOWER_CAVEAT } from '../utils/reinsuranceDisplay';
import { formatCurrency, formatPct, colorForNetIncome } from '../utils/formatters';
import { lineDisplayName } from '../utils/lineDisplay';
import { LINE_RESERVE_PAYDOWN_PCT } from '../data/defaultAssumptions';

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
            <StatementCard title="Statement of Revenues, Expenses & Changes in Net Position">
              {(() => {
                const is = statement.incomeStatement;
                // Pass-throughs shown GROSS: reinsurance and admin appear as
                // both revenue (collected from members) and expense (paid out).
                const totalOperatingRevenues = is.reinsuranceCost + is.poolPremium + is.adminExpense + is.assessments;
                // Prior accident years' NET incurred: net paid + change in net
                // unpaid on prior cohorts (development net of ceded, including
                // closed-cohort runoff). Current + recoveries + prior ties to
                // netIncurredLoss as an algebraic identity — no plug.
                const priorYearClaims = is.netIncurredLoss - is.netUltimateLoss;
                const totalOperatingExpenses = is.reinsuranceCost + is.netIncurredLoss + is.operatingExpense + is.riskControlInvestment + is.dividends;
                // Not modeled yet — rendered only when non-zero, so hidden today.
                const additionalPaidInCapital = 0;
                const restatements = 0;
                const showRestatedBlock = additionalPaidInCapital !== 0 || restatements !== 0;
                return (
                  <>
                    <SectionLabel text="Operating revenues" />
                    <ISLine label="Premiums for transferred risk" value={formatCurrency(is.reinsuranceCost)} indent />
                    <ISLine label="Contributions for retained risk" value={formatCurrency(is.poolPremium)} indent />
                    <ISLine label="Administration fees" value={formatCurrency(is.adminExpense)} indent />
                    <ISLine label="Member assessments" value={formatCurrency(is.assessments)} indent />
                    <ISLine label="Total operating revenues" value={formatCurrency(totalOperatingRevenues)} bold />

                    <SectionLabel text="Operating expenses" />
                    <ISLine label="Transferred risk & insurance expense" value={formatCurrency(is.reinsuranceCost)} indent />
                    <ISLine label="Provision for claims:" value="" indent />
                    <ISLine label="Current year claims" value={formatCurrency(is.grossUltimateLoss)} indent2 />
                    {is.reinsuranceRecovery !== 0 && (
                      <ISLine label="Less: reinsurance recoveries — current year" value={`(${formatCurrency(is.reinsuranceRecovery)})`} indent2 />
                    )}
                    {/* ⚠ BESIDE THE CURRENT-YEAR RECOVERY, BECAUSE THAT IS WHAT IT
                        REDUCES. Booking this year's claim register low reduces the
                        recoverable along with the claims. It used to hide inside the
                        prior-year development line below, where it was a CURRENT-year
                        item wearing a prior-year label and made that line understate
                        development cession by its own size.

                        DEFERRED, NOT FORGONE. Every dollar here comes back through
                        the line below as the accident year develops and the
                        optimistic booking unwinds — so the word must not assert a
                        permanent loss. Reads $0 whenever the line is funded at or
                        above break-even, which is the common case and has to look
                        unremarkable. */}
                    {is.bookingGiveBack !== 0 && (
                      <ISLine label="Recovery deferred by optimistic booking" value={formatCurrency(is.bookingGiveBack)} indent2 />
                    )}
                    {/* ⚠ SPLIT OUT SO THE COVER IS VISIBLE RESPONDING TO A RESERVE
                        BLOWING UP. Development on a prior accident year now lands
                        on claims and cedes; folded into one recovery total the
                        player cannot tell a $25M reserve deterioration that the
                        tower absorbed from one it did not. These lines are MEMO
                        figures — the loss above is already net of each. */}
                    {is.priorYearDevelopmentCeded !== 0 && (
                      <ISLine label="Less: reinsurance recoveries — prior-year development" value={`(${formatCurrency(is.priorYearDevelopmentCeded)})`} indent2 />
                    )}
                    {/* DISCLOSED, NOT DEDUCTED. This band sits ABOVE the top of the
                        tower: no recovery exists against it at any price, so it is
                        already inside "Current year claims" above and must not be
                        subtracted again. It is shown because it is the pool's largest
                        single exposure and was previously invisible. */}
                    {statement.retainedAboveTower > 0 && (
                      <ISLine
                        label="  of which retained above tower (unreinsurable)"
                        value={formatCurrency(statement.retainedAboveTower)}
                        indent2
                      />
                    )}
                    <ISLine label="Prior year claims" value={formatCurrency(priorYearClaims)} indent2 />
                    <ISLine label="Provision for claims, net" value={formatCurrency(is.netIncurredLoss)} indent2 />
                    <ISLine label="General administrative services" value={formatCurrency(is.operatingExpense)} indent />
                    <ISLine label="Loss prevention expenses" value={formatCurrency(is.riskControlInvestment)} indent />
                    <ISLine label="Member dividends & returned premium" value={formatCurrency(is.dividends)} indent />
                    <ISLine label="Total operating expenses" value={formatCurrency(totalOperatingExpenses)} bold />
                    {statement.retainedAboveTower > 0 && (
                      <p className="text-xs text-gray-500 italic leading-relaxed pt-2">{RETAINED_ABOVE_TOWER_CAVEAT}</p>
                    )}

                    <div className="border-t border-gray-200 my-2" />
                    <ISLine label="Operating income (loss)" value={formatCurrency(is.underwritingIncome)} bold valueColor={colorForNetIncome(is.underwritingIncome)} />

                    <SectionLabel text="Nonoperating revenues (expenses)" />
                    <ISLine label="Investment income, net of investment expense" value={formatCurrency(is.investmentIncome)} indent valueColor={is.investmentIncome >= 0 ? 'text-emerald-600' : 'text-red-600'} />
                    <ISLine label="Total nonoperating revenues (expenses)" value={formatCurrency(is.investmentIncome)} bold />

                    <div className="border-t border-gray-200 my-2" />
                    <ISLine label="Change in net position" value={formatCurrency(is.netIncome)} bold valueColor={colorForNetIncome(is.netIncome)} />

                    <SectionLabel text="Net position" />
                    <ISLine label="Beginning of year" value={formatCurrency(statement.surplusRollforward.beginingSurplus)} indent />
                    {showRestatedBlock && (
                      <>
                        <ISLine label="Additional paid in capital" value={formatCurrency(additionalPaidInCapital)} indent />
                        <ISLine label="Restatements" value={formatCurrency(restatements)} indent />
                        <ISLine label="Beginning of year, as restated" value={formatCurrency(statement.surplusRollforward.beginingSurplus + additionalPaidInCapital + restatements)} indent />
                      </>
                    )}
                    <ISLine label="Net position, end of year" value={formatCurrency(statement.surplusRollforward.endingSurplus)} bold valueColor={statement.surplusRollforward.endingSurplus >= 0 ? 'text-emerald-700' : 'text-red-700'} />
                  </>
                );
              })()}
            </StatementCard>
            <StatementCard title="Statement of Net Position">
              {(() => {
                const bs = statement.balanceSheet;
                const alloc = selectedResult!.assetAllocation;
                const investedAssets = bs.investments;
                const cashSlice = investedAssets * (alloc.cashPct / 100);
                const cashAndEquivalents = bs.cash + cashSlice;
                const noncurrentInvestments = investedAssets - cashSlice;
                const totalCurrentAssets = cashAndEquivalents;
                const totalNoncurrentAssets = noncurrentInvestments;

                // Current portion = the share of each line's own net unpaid
                // reserve expected to pay out within 12 months, using that
                // line's own reserve paydown rate (the same rate the engine
                // already applies to every cohort each year). Pool view sums
                // each active line's own reserve x its own line's rate.
                const pooled = selectedResult as unknown as ResultSet;
                const lineKeys = pooled.byLine ? (Object.keys(pooled.byLine) as CoverageLine[]) : null;
                const currentUnpaidPortion = lineKeys
                  ? lineKeys.reduce((sum, l) => sum + pooled.byLine[l].endingNetReserve * (LINE_RESERVE_PAYDOWN_PCT[l] ?? 0), 0)
                  : bs.netUnpaidReserve * (LINE_RESERVE_PAYDOWN_PCT[lineView as CoverageLine] ?? 0);
                const noncurrentUnpaidPortion = bs.netUnpaidReserve - currentUnpaidPortion;

                const totalCurrentLiabilities = currentUnpaidPortion;
                const totalNoncurrentLiabilities = noncurrentUnpaidPortion;

                return (
                  <>
                    <SectionLabel text="Current assets" />
                    <BSLine label="Cash and cash equivalents" value={formatCurrency(cashAndEquivalents)} indent />
                    <BSLine label="Total current assets" value={formatCurrency(totalCurrentAssets)} bold />

                    <SectionLabel text="Noncurrent assets" />
                    <BSLine label="Investments" value={formatCurrency(totalNoncurrentAssets)} indent />
                    <BSLine label="Total noncurrent assets" value={formatCurrency(totalNoncurrentAssets)} bold />

                    <div className="border-t border-gray-200 my-2" />
                    <BSLine label="Total assets" value={formatCurrency(bs.totalAssets)} bold highlight />

                    <SectionLabel text="Current liabilities" />
                    <BSLine label="Unpaid loss and LAE reserve, net of reinsurance — current portion" value={formatCurrency(currentUnpaidPortion)} indent />
                    <BSLine label="Total current liabilities" value={formatCurrency(totalCurrentLiabilities)} bold />

                    <SectionLabel text="Noncurrent liabilities" />
                    <BSLine label="Unpaid loss and LAE reserve, net of reinsurance — noncurrent portion" value={formatCurrency(noncurrentUnpaidPortion)} indent />
                    <BSLine label="Total noncurrent liabilities" value={formatCurrency(totalNoncurrentLiabilities)} bold />

                    <div className="border-t border-gray-200 my-2" />
                    <BSLine label="Total liabilities" value={formatCurrency(bs.totalLiabilities)} bold highlight />

                    <div className="border-t border-gray-200 my-2" />
                    <BSLine label="Net position — unrestricted" value={formatCurrency(bs.surplus)} bold highlight valueColor={bs.surplus >= 0 ? 'text-emerald-700' : 'text-red-700'} />
                  </>
                );
              })()}
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

function BSLine({ label, value, bold, highlight, valueColor = 'text-gray-800', indent }: { label: string; value: string; bold?: boolean; highlight?: boolean; valueColor?: string; indent?: boolean }) {
  return (
    <div className={`flex justify-between items-baseline gap-2 ${indent ? 'pl-4' : ''} ${highlight ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
      <span className={`text-sm text-gray-600 ${bold ? 'font-semibold text-gray-800' : ''}`}>{label}</span>
      <span className={`text-sm font-mono ${bold ? 'font-bold' : 'font-medium'} ${valueColor} text-right`}>{value}</span>
    </div>
  );
}

function ISLine({ label, value, bold, valueColor = 'text-gray-800', indent, indent2 }: { label: string; value: string; bold?: boolean; valueColor?: string; indent?: boolean; indent2?: boolean }) {
  return (
    <div className={indent2 ? 'pl-8' : indent ? 'pl-4' : ''}>
      {BSLine({ label, value, bold, valueColor })}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">{text}</p>;
}

function MetricRow({ label, value, valueColor = 'text-gray-800' }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between items-center gap-2 py-0.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-semibold ${valueColor}`}>{value}</span>
    </div>
  );
}
