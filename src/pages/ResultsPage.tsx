import React, { useState } from 'react';
import {
  ClipboardList,
  Zap,
  TrendingUp,
  Shield,
  DollarSign,
  AlertTriangle,
  Target,
} from 'lucide-react';
import type { ResultSet } from '../types/simulation';
import {
  formatCurrency,
  formatPct,
  colorForRatio,
  colorForNetIncome,
  colorForSurplus,
} from '../utils/formatters';
import { REINSURANCE_PROGRAMS } from '../data/defaultAssumptions';

interface ResultsPageProps {
  lockedResults: ResultSet[];
}

export default function ResultsPage({ lockedResults }: ResultsPageProps) {
  const [selectedYear, setSelectedYear] = useState<number>(
    lockedResults.length > 0 ? lockedResults[lockedResults.length - 1].yearNumber : 1
  );

  const result = lockedResults.find(r => r.yearNumber === selectedYear);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Annual Results</h2>
          <p className="text-gray-500 text-sm">Detailed breakdown for each completed year</p>
        </div>

        {lockedResults.length > 0 && (
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(parseInt(e.target.value))}
            className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {lockedResults.map(r => (
              <option key={r.yearNumber} value={r.yearNumber}>
                Year {r.yearNumber} / {r.calendarYear}
              </option>
            ))}
          </select>
        )}
      </div>

      {lockedResults.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <ClipboardList size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium text-lg">No results yet</p>
          <p className="text-sm mt-1">Complete a year to see detailed results here.</p>
        </div>
      )}

      {result && (
        <div className="space-y-5">
          {result.shockLossIncurred && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="font-bold text-red-800">Shock Loss Event</p>
                <p className="text-red-700 text-sm">
                  A significant shock loss occurred this year, materially increasing gross losses above expected levels.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ResultCard title="Decision Summary" icon={<ClipboardList size={16} />}>
              <Row
                label="Rate Change"
                value={formatPct(result.decisions.rateChange, 1)}
                valueColor={
                  result.decisions.rateChange > 0
                    ? 'text-amber-600'
                    : result.decisions.rateChange < 0
                      ? 'text-blue-600'
                      : 'text-gray-700'
                }
              />
              <Row label="Funding Confidence Level" value={formatPct(result.decisions.fundingConfidenceLevel, 0)} />
              <Row label="Dividend / Return of Pool Premium" value={formatPct(result.decisions.dividendPct, 1)} />
              <Row label="Assessment" value={formatPct(result.decisions.assessmentPct, 1)} />
              <Row label="Underwriting Strictness" value={`${result.decisions.underwritingStrictness} / 10`} />
              <Row label="Risk Control Investment" value={formatPct(result.decisions.riskControlPct, 1)} />
              <Row
                label="Reinsurance Level"
                value={`${result.decisions.reinsuranceLevel} — ${REINSURANCE_PROGRAMS[result.decisions.reinsuranceLevel]?.label ?? ''}`}
              />
              <Row label="Investment Risk" value={`${result.decisions.investmentRisk} / 10`} />
            </ResultCard>

            <ResultCard title="Membership" icon={<TrendingUp size={16} />}>
              <Row label="Active Members" value={String(result.activeMembers)} />
              <Row label="New Members This Year" value={`+${result.newMembers}`} valueColor="text-emerald-600" />
              <Row
                label="Members Withdrawn"
                value={result.withdrawnMembers > 0 ? `-${result.withdrawnMembers}` : '0'}
                valueColor={result.withdrawnMembers > 0 ? 'text-red-600' : 'text-gray-700'}
              />
              <Row label="Member Retention Rate" value={formatPct(result.memberRetentionRate)} />
              <Row label="Member Satisfaction" value={`${result.memberSatisfaction.toFixed(1)} / 10`} />
              <Row label="Avg. Risk Quality" value={`${result.averageRiskQuality.toFixed(1)} / 10`} />
              <Row label="Payroll Exposure ($M)" value={`$${result.activeExposure.toFixed(2)}M`} />
              <Row label="Total Market Payroll ($M)" value={`$${result.totalMarketExposure.toFixed(2)}M`} />
              <Row label="Exposure-Based Market Share" value={formatPct(result.marketShare)} valueColor="text-sky-600" />
            </ResultCard>

            <ResultCard title="Premium & Losses" icon={<DollarSign size={16} />}>
              <Row label="Rate Level Index" value={result.rateLevel.toFixed(2)} />
              <Row label="Pure Premium Rate per $100 Payroll" value={`$${result.purePremiumPer100.toFixed(2)}`} />
              <Row
                label={`Pool Premium Rate at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}% CLF`}
                value={`$${(result.poolPremium / Math.max(result.activeExposure * 10_000, 1)).toFixed(2)}`}
              />
              <Row label="Written Payroll ($M)" value={`$${result.writtenExposure.toFixed(2)}M`} />
              <Row label="Pool Premium" value={formatCurrency(result.poolPremium)} />
              <Row label="Admin Expense" value={formatCurrency(result.adminExpense)} />
              <Row label="Pool Premium & Admin Expense" value={formatCurrency(result.poolPremiumAndAdminExpense)} />
              <Row label="Reinsurance Cost" value={formatCurrency(result.reinsuranceCost)} />
              <Row label="Gross Premium & Admin Expense" value={formatCurrency(result.totalMemberCharge)} bold />
              <Row label="Assessments" value={formatCurrency(result.assessments)} />
              <Row label="Dividends / Returned Pool Premium" value={formatCurrency(result.dividends)} valueColor="text-red-600" />
              <div className="border-t border-gray-100 my-1" />
              <Row label="Actual Ultimate Losses" value={formatCurrency(result.grossUltimateLoss)} valueColor="text-red-600" />
              <Row label="Reinsurance Recovery" value={formatCurrency(result.reinsuranceRecovery)} valueColor="text-emerald-600" />
              <Row label="Net Ultimate Loss" value={formatCurrency(result.netUltimateLoss)} valueColor="text-red-600" />
            </ResultCard>

            <ResultCard title="Accounting Reserves & Development" icon={<Shield size={16} />}>
              <Row label="Admin Expense" value={formatCurrency(result.adminExpense)} valueColor="text-red-600" />
              <Row label="Risk Control Investment" value={formatCurrency(result.riskControlInvestment)} valueColor="text-amber-600" />
              <Row label="Reinsurance Cost" value={formatCurrency(result.reinsuranceCost)} valueColor="text-red-600" />
              <div className="border-t border-gray-100 my-1" />
              <Row
                label="Prior-Year Development"
                value={formatCurrency(result.priorYearDevelopment)}
                valueColor={result.priorYearDevelopment >= 0 ? 'text-emerald-600' : 'text-red-600'}
              />
              <Row label="Beginning Gross Reserve" value={formatCurrency(result.beginningGrossReserve)} />
              <Row label="Current-Year Gross Reserve" value={formatCurrency(result.currentYearGrossReserve)} />
              <Row label="Gross Paid Losses" value={formatCurrency(result.grossPaidLosses)} />
              <Row label="Ending Gross Accounting Reserve" value={formatCurrency(result.endingGrossReserve)} />
              <Row label="Reinsurance Recoverable on Unpaid" value={formatCurrency(result.endingReinsRecoverable)} />
              <Row label="Net Accounting Reserve" value={formatCurrency(result.expectedNetUnpaidLoss)} />
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                Accounting reserves are expected unpaid claims from incurred losses. They are not multiplied by CLF.
              </p>
            </ResultCard>

            <ResultCard title="Investment & Income" icon={<Zap size={16} />}>
              <Row label="Invested Assets" value={formatCurrency(result.investedAssets)} />
              <Row
                label="Investment Return Rate"
                value={formatPct(result.investmentReturnRate)}
                valueColor={result.investmentReturnRate >= 0 ? 'text-emerald-600' : 'text-red-600'}
              />
              <Row label="Investment Income" value={formatCurrency(result.investmentIncome)} valueColor={colorForNetIncome(result.investmentIncome)} />
              <div className="border-t border-gray-100 my-1" />
              <Row label="Expected Loss Ratio" value={formatPct(result.expectedLossRatio)} />
              <Row label="Expected Expense Ratio" value={formatPct(result.expectedExpenseRatio)} />
              <Row label="Expected Combined Ratio" value={formatPct(result.expectedCombinedRatio)} />
              <div className="border-t border-gray-100 my-1" />
              <Row label="Actual Loss Ratio (Net)" value={formatPct(result.actualLossRatio)} />
              <Row label="Actual Expense Ratio" value={formatPct(result.actualExpenseRatio)} />
              <Row label="Actual Combined Ratio" value={formatPct(result.actualCombinedRatio)} valueColor={colorForRatio(result.actualCombinedRatio)} />
              <div className="border-t border-gray-100 my-1" />
              <Row label="Net Income" value={formatCurrency(result.netIncome)} valueColor={colorForNetIncome(result.netIncome)} />
            </ResultCard>

            <ResultCard title="Net Equity / Surplus Rollforward" icon={<DollarSign size={16} />}>
              <Row label="Beginning Surplus" value={formatCurrency(result.beginingSurplus)} />
              <Row label="Net Income" value={formatCurrency(result.netIncome)} valueColor={colorForNetIncome(result.netIncome)} />
              <div className="border-t border-gray-100 my-1" />
              <Row label="= Surplus from Income" value={formatCurrency(result.surplusFromIncome)} />
              <Row
                label="Ending Surplus (Balance Sheet)"
                value={formatCurrency(result.endingSurplus)}
                valueColor={colorForSurplus(result.endingSurplus)}
                bold
              />
              <Row
                label="Tie-Out Difference"
                value={formatCurrency(result.surplusTieOutDifference)}
                valueColor={Math.abs(result.surplusTieOutDifference) < 100 ? 'text-emerald-600' : 'text-amber-600'}
              />
              <p className="text-xs text-gray-400 mt-2">
                Balance check: {formatCurrency(result.totalAssets)} Assets - {formatCurrency(result.totalLiabilities)} Liabilities ={' '}
                {formatCurrency(result.endingSurplus)}
              </p>
              {Math.abs(result.surplusTieOutDifference) < 100 ? (
                <p className="text-xs text-emerald-600 mt-1">
                  Surplus rollforward ties to the balance sheet.
                </p>
              ) : (
                <p className="text-xs text-amber-600 mt-1">
                  Tie-out difference should normally be near zero. A difference may occur if cash or investments are floored at zero,
                  or if old saved results were created under prior accounting logic.
                </p>
              )}
            </ResultCard>

            <ResultCard title="Funding Rate Build-Up" icon={<Target size={16} />}>
              {(() => {
                const rateAtConfidenceLevel = result.poolPremium / Math.max(result.activeExposure * 10_000, 1);

                return (
                  <>
                    <Row label="Pure Premium Rate per $100 Payroll" value={`$${result.purePremiumPer100.toFixed(2)}`} />

                    <Row
                      label="Selected Funding Confidence"
                      value={formatPct(result.selectedFundingConfidenceLevel, 0)}
                      valueColor="text-blue-600"
                    />

                    <Row label="Selected CLF" value={result.selectedFundingCLF.toFixed(3)} />

                    <Row
                      label={`Pool Premium Rate at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}% CLF`}
                      value={`$${rateAtConfidenceLevel.toFixed(2)}`}
                      valueColor="text-amber-600"
                    />

                    <Row label="Pool Premium" value={formatCurrency(result.poolPremium)} />
                    <Row label="Admin Expense" value={formatCurrency(result.adminExpense)} />
                    <Row label="Pool Premium & Admin Expense" value={formatCurrency(result.poolPremiumAndAdminExpense)} />
                    <Row label="Reinsurance Cost" value={formatCurrency(result.reinsuranceCost)} />
                    <Row label="Gross Premium & Admin Expense" value={formatCurrency(result.totalMemberCharge)} bold />

                    <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                      The selected CLF produces Pool Premium. Admin expense is added next, followed by the separately
                      stated reinsurance cost.
                    </p>
                  </>
                );
              })()}
            </ResultCard>

            <ResultCard title="Reserve View" icon={<Shield size={16} />}>
              <Row label="Expected Gross Unpaid Loss" value={formatCurrency(result.expectedGrossUnpaidLoss)} />
              <Row label="Expected Reinsurance Recoverable" value={formatCurrency(result.expectedReinsuranceRecoverable)} valueColor="text-emerald-600" />
              <Row label="Expected Net Unpaid Loss" value={formatCurrency(result.expectedNetUnpaidLoss)} />
              <div className="border-t border-gray-100 my-1" />
              <Row
                label="Required Reserve Margin"
                value={formatCurrency(result.reserveRiskMarginNeeded)}
                valueColor={result.reserveRiskMarginNeeded > 0 ? 'text-amber-600' : 'text-emerald-600'}
              />
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                The required reserve margin is held in surplus above the expected net unpaid loss.
              </p>
            </ResultCard>

            <ResultCard title="Capital / Surplus Cushion" icon={<Target size={16} />}>
              <Row label="Surplus" value={formatCurrency(result.availableSurplus)} valueColor={colorForSurplus(result.availableSurplus)} />
              <Row label="Required Reserve Margin" value={formatCurrency(result.reserveRiskMarginNeeded)} valueColor="text-amber-600" />
              <div className="border-t border-gray-100 my-1" />
              <Row
                label="Excess Available Surplus"
                value={formatCurrency(result.excessAvailableSurplus)}
                valueColor={result.excessAvailableSurplus >= 0 ? 'text-emerald-600' : 'text-red-600'}
                bold
              />
              <Row label="Excess Capital Ratio" value={result.excessCapitalRatio === null ? 'N/A' : formatPct(result.excessCapitalRatio)} />
              <Row
                label="Excess Capital Status"
                value={result.capitalAdequacyStatus}
                valueColor={statusColor(result.capitalAdequacyStatus)}
              />
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                Zero means surplus exactly equals the required reserve margin. Positive values indicate excess capital;
                negative values indicate a deficit.
              </p>
            </ResultCard>

            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
                <ClipboardList size={16} className="text-blue-600" />
                <h3 className="font-bold text-gray-900 text-sm">What Happened This Year</h3>
              </div>
              <div className="p-5">
                <p className="text-gray-700 text-sm leading-relaxed">{result.narrativeExplanation}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>
      <div className="p-5 space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  valueColor = 'text-gray-800',
  bold = false,
}: {
  label: string;
  value: string;
  valueColor?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-semibold font-mono ${valueColor} text-right ${bold ? 'font-bold' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function statusColor(status: string): string {
  if (status === 'Strong') return 'text-emerald-600';
  if (status === 'Adequate') return 'text-emerald-600';
  if (status === 'Thin') return 'text-amber-600';
  return 'text-red-600';
}
