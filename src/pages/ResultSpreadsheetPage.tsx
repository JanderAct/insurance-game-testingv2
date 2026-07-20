import React, { useMemo, useState } from 'react';
import { Download, ClipboardList, Table, Users } from 'lucide-react';
import type { ResultSet } from '../types/simulation';
import { formatCurrency, formatPct } from '../utils/formatters';
import { REINSURANCE_PROGRAMS } from '../data/defaultAssumptions';
import { getMemberExposure } from '../utils/lineHelpers';

interface ResultSpreadsheetPageProps {
  lockedResults: ResultSet[];
}

interface SpreadsheetMetric {
  key: string;
  category: string;
  label: string;
  value: (result: ResultSet) => string | number;
  csvValue?: (result: ResultSet) => string | number;
}

export default function ResultSpreadsheetPage({ lockedResults }: ResultSpreadsheetPageProps) {
  const [selectedYear, setSelectedYear] = useState<number>(
    lockedResults.length > 0 ? lockedResults[lockedResults.length - 1].yearNumber : 1
  );

  const selectedResult = lockedResults.find(r => r.yearNumber === selectedYear);

  const resultMetrics = useMemo<SpreadsheetMetric[]>(() => {
    return [
      {
        key: 'yearNumber',
        category: 'Year',
        label: 'Year Number',
        value: r => r.yearNumber,
      },
      {
        key: 'calendarYear',
        category: 'Year',
        label: 'Calendar Year',
        value: r => r.calendarYear,
      },

      // Decisions
      {
        key: 'rateChange',
        category: 'Decisions',
        label: 'Rate Change',
        value: r => formatPct(r.decisions.rateChange, 1),
        csvValue: r => r.decisions.rateChange,
      },
      {
        key: 'fundingConfidenceLevel',
        category: 'Decisions',
        label: 'Funding Confidence Level',
        value: r => formatPct(r.selectedFundingConfidenceLevel, 0),
        csvValue: r => r.selectedFundingConfidenceLevel,
      },
      {
        key: 'selectedFundingCLF',
        category: 'Decisions',
        label: 'Selected CLF',
        value: r => r.selectedFundingCLF.toFixed(3),
        csvValue: r => r.selectedFundingCLF,
      },
      {
        key: 'dividendPct',
        category: 'Decisions',
        label: 'Dividend %',
        value: r => formatPct(r.decisions.dividendPct, 1),
        csvValue: r => r.decisions.dividendPct,
      },
      {
        key: 'assessmentPct',
        category: 'Decisions',
        label: 'Assessment %',
        value: r => formatPct(r.decisions.assessmentPct, 1),
        csvValue: r => r.decisions.assessmentPct,
      },
      {
        key: 'underwritingStrictness',
        category: 'Decisions',
        label: 'Underwriting Strictness',
        value: r => r.decisions.underwritingStrictness,
      },
      {
        key: 'riskControlPct',
        category: 'Decisions',
        label: 'Risk Control %',
        value: r => formatPct(r.decisions.riskControlPct, 1),
        csvValue: r => r.decisions.riskControlPct,
      },
      {
        key: 'reinsuranceLevel',
        category: 'Decisions',
        label: 'Reinsurance Level',
        value: r => `${r.decisions.reinsuranceLevel} - ${REINSURANCE_PROGRAMS[r.decisions.reinsuranceLevel]?.label ?? ''}`,
        csvValue: r => r.decisions.reinsuranceLevel,
      },
      {
        key: 'assetAllocation',
        category: 'Decisions',
        label: 'Asset Allocation',
        value: r => `Cash ${r.assetAllocation.cashPct.toFixed(0)}% / Bonds ${r.assetAllocation.bondsPct.toFixed(0)}% / Equities ${r.assetAllocation.equitiesPct.toFixed(0)}%`,
      },

      // Membership
      {
        key: 'activeMembers',
        category: 'Membership',
        label: 'Active Members',
        value: r => r.activeMembers,
      },
      {
        key: 'newMembers',
        category: 'Membership',
        label: 'New Members',
        value: r => r.newMembers,
      },
      {
        key: 'withdrawnMembers',
        category: 'Membership',
        label: 'Withdrawn Members',
        value: r => r.withdrawnMembers,
      },
      {
        key: 'memberRetentionRate',
        category: 'Membership',
        label: 'Member Retention Rate',
        value: r => formatPct(r.memberRetentionRate),
        csvValue: r => r.memberRetentionRate,
      },
      {
        key: 'memberSatisfaction',
        category: 'Membership',
        label: 'Member Satisfaction',
        value: r => r.memberSatisfaction.toFixed(2),
        csvValue: r => r.memberSatisfaction,
      },
      {
        key: 'averageRiskQuality',
        category: 'Membership',
        label: 'Average Risk Quality',
        value: r => r.averageRiskQuality.toFixed(2),
        csvValue: r => r.averageRiskQuality,
      },
      {
        key: 'activeExposure',
        category: 'Membership',
        label: 'Active Payroll Exposure ($M)',
        value: r => r.activeExposure.toFixed(2),
        csvValue: r => r.activeExposure,
      },
      {
        key: 'totalMarketExposure',
        category: 'Membership',
        label: 'Total Market Payroll ($M)',
        value: r => r.totalMarketExposure.toFixed(2),
        csvValue: r => r.totalMarketExposure,
      },
      {
        key: 'marketShare',
        category: 'Membership',
        label: 'Market Share',
        value: r => formatPct(r.marketShare),
        csvValue: r => r.marketShare,
      },

      // Rate and premium
      {
        key: 'rateLevel',
        category: 'Rate and Premium',
        label: 'Rate Level Index',
        value: r => r.rateLevel.toFixed(3),
        csvValue: r => r.rateLevel,
      },
      {
        key: 'purePremiumRatePer100',
        category: 'Rate and Premium',
        label: 'Pure Premium Rate per $100 Payroll',
        value: r => dollars(r.purePremiumPer100),
        csvValue: r => r.purePremiumPer100,
      },
      {
        key: 'poolPremiumRateAtSelectedClf',
        category: 'Rate and Premium',
        label: 'Pool Premium Rate at Selected CLF',
        value: r => dollars(r.poolPremium / Math.max(r.activeExposure * 10_000, 1)),
        csvValue: r => r.poolPremium / Math.max(r.activeExposure * 10_000, 1),
      },
      {
        key: 'totalMemberRatePer100',
        category: 'Rate and Premium',
        label: 'Gross Premium & Admin Expense Rate per $100',
        value: r => dollars(r.ratePer100),
        csvValue: r => r.ratePer100,
      },
      {
        key: 'writtenExposure',
        category: 'Rate and Premium',
        label: 'Written Payroll ($M)',
        value: r => r.writtenExposure.toFixed(2),
        csvValue: r => r.writtenExposure,
      },
      {
        key: 'purePremiumAtOne',
        category: 'Rate and Premium',
        label: 'Pure Premium',
        value: r => formatCurrency(r.expectedLoss),
        csvValue: r => roundDollars(r.expectedLoss),
      },
      {
        key: 'poolPremium',
        category: 'Rate and Premium',
        label: 'Pool Premium at Selected CLF',
        value: r => formatCurrency(r.poolPremium),
        csvValue: r => roundDollars(r.poolPremium),
      },
      {
        key: 'adminExpense',
        category: 'Rate and Premium',
        label: 'Admin Expense',
        value: r => formatCurrency(r.adminExpense),
        csvValue: r => roundDollars(r.adminExpense),
      },
      {
        key: 'totalMemberCharge',
        category: 'Rate and Premium',
        label: 'Gross Premium & Admin Expense',
        value: r => formatCurrency(r.totalMemberCharge),
        csvValue: r => roundDollars(r.totalMemberCharge),
      },
      {
        key: 'assessments',
        category: 'Rate and Premium',
        label: 'Assessments',
        value: r => formatCurrency(r.assessments),
        csvValue: r => roundDollars(r.assessments),
      },
      {
        key: 'dividends',
        category: 'Rate and Premium',
        label: 'Dividends / Returned Pool Premium',
        value: r => formatCurrency(r.dividends),
        csvValue: r => roundDollars(r.dividends),
      },

      // Losses
      {
        key: 'expectedLoss',
        category: 'Losses',
        label: 'Pure Premium',
        value: r => formatCurrency(r.expectedLoss),
        csvValue: r => roundDollars(r.expectedLoss),
      },
      {
        key: 'clfAdjustedExpectedLoss',
        category: 'Losses',
        label: 'Pool Premium at Selected CLF',
        value: r => formatCurrency(r.clfAdjustedExpectedLoss),
        csvValue: r => roundDollars(r.clfAdjustedExpectedLoss),
      },
      {
        key: 'aggregateMemberLoss',
        category: 'Losses',
        label: 'Member-Level Simulated Loss incl. Shared Events',
        value: r => formatCurrency(r.aggregateMemberLoss ?? r.grossUltimateLoss),
        csvValue: r => roundDollars(r.aggregateMemberLoss ?? r.grossUltimateLoss),
      },
      {
        key: 'commonLossFactor',
        category: 'Losses',
        label: 'Shared Annual Loss Factor',
        value: r => (r.commonLossFactor ?? 1).toFixed(4),
        csvValue: r => r.commonLossFactor ?? 1,
      },
      {
        key: 'catastropheFactor',
        category: 'Losses',
        label: 'Catastrophe Factor',
        value: r => (r.catastropheFactor ?? 1).toFixed(4),
        csvValue: r => r.catastropheFactor ?? 1,
      },
      {
        key: 'shockLossAmount',
        category: 'Losses',
        label: 'Shock Uplift (included in simulated loss)',
        value: r => formatCurrency(r.shockLossAmount ?? 0),
        csvValue: r => roundDollars(r.shockLossAmount ?? 0),
      },
      {
        key: 'grossUltimateLoss',
        category: 'Losses',
        label: 'Gross Ultimate Loss + LAE',
        value: r => formatCurrency(r.grossUltimateLoss),
        csvValue: r => roundDollars(r.grossUltimateLoss),
      },
      {
        key: 'shockLossIncurred',
        category: 'Losses',
        label: 'Shock Loss Incurred',
        value: r => (r.shockLossIncurred ? 'Yes' : 'No'),
      },
      {
        key: 'reinsuranceRecovery',
        category: 'Losses',
        label: 'Reinsurance Recovery',
        value: r => formatCurrency(r.reinsuranceRecovery),
        csvValue: r => roundDollars(r.reinsuranceRecovery),
      },
      {
        key: 'netUltimateLoss',
        category: 'Losses',
        label: 'Net Ultimate Loss + LAE',
        value: r => formatCurrency(r.netUltimateLoss),
        csvValue: r => roundDollars(r.netUltimateLoss),
      },

      // Expenses and income
      {
        key: 'operatingExpense',
        category: 'Expenses and Income',
        label: 'Operating Expense',
        value: r => formatCurrency(r.operatingExpense),
        csvValue: r => roundDollars(r.operatingExpense),
      },
      {
        key: 'riskControlInvestment',
        category: 'Expenses and Income',
        label: 'Risk Control Investment',
        value: r => formatCurrency(r.riskControlInvestment),
        csvValue: r => roundDollars(r.riskControlInvestment),
      },
      {
        key: 'reinsuranceCost',
        category: 'Expenses and Income',
        label: 'Reinsurance Cost',
        value: r => formatCurrency(r.reinsuranceCost),
        csvValue: r => roundDollars(r.reinsuranceCost),
      },
      {
        key: 'investedAssets',
        category: 'Expenses and Income',
        label: 'Invested Assets',
        value: r => formatCurrency(r.investedAssets),
        csvValue: r => roundDollars(r.investedAssets),
      },
      {
        key: 'investmentReturnRate',
        category: 'Expenses and Income',
        label: 'Investment Return Rate',
        value: r => formatPct(r.investmentReturnRate),
        csvValue: r => r.investmentReturnRate,
      },
      {
        key: 'investmentIncome',
        category: 'Expenses and Income',
        label: 'Investment Income',
        value: r => formatCurrency(r.investmentIncome),
        csvValue: r => roundDollars(r.investmentIncome),
      },
      {
        key: 'netIncome',
        category: 'Expenses and Income',
        label: 'Net Income',
        value: r => formatCurrency(r.netIncome),
        csvValue: r => roundDollars(r.netIncome),
      },

      // Reserves
      {
        key: 'priorYearDevelopment',
        category: 'Reserves',
        label: 'Prior-Year Development',
        value: r => formatCurrency(r.priorYearDevelopment),
        csvValue: r => roundDollars(r.priorYearDevelopment),
      },
      {
        key: 'beginningGrossReserve',
        category: 'Reserves',
        label: 'Beginning Gross Reserve',
        value: r => formatCurrency(r.beginningGrossReserve),
        csvValue: r => roundDollars(r.beginningGrossReserve),
      },
      {
        key: 'currentYearGrossReserve',
        category: 'Reserves',
        label: 'Current-Year Gross Reserve',
        value: r => formatCurrency(r.currentYearGrossReserve),
        csvValue: r => roundDollars(r.currentYearGrossReserve),
      },
      {
        key: 'grossPaidLosses',
        category: 'Reserves',
        label: 'Gross Paid Losses',
        value: r => formatCurrency(r.grossPaidLosses),
        csvValue: r => roundDollars(r.grossPaidLosses),
      },
      {
        key: 'endingGrossReserve',
        category: 'Reserves',
        label: 'Ending Gross Reserve',
        value: r => formatCurrency(r.endingGrossReserve),
        csvValue: r => roundDollars(r.endingGrossReserve),
      },
      {
        key: 'beginningReinsRecoverable',
        category: 'Reserves',
        label: 'Beginning RI Recoverable',
        value: r => formatCurrency(r.beginningReinsRecoverable),
        csvValue: r => roundDollars(r.beginningReinsRecoverable),
      },
      {
        key: 'endingReinsRecoverable',
        category: 'Reserves',
        label: 'Ending RI Recoverable',
        value: r => formatCurrency(r.endingReinsRecoverable),
        csvValue: r => roundDollars(r.endingReinsRecoverable),
      },
      {
        key: 'expectedNetUnpaidLoss',
        category: 'Reserves',
        label: 'Expected Net Unpaid Loss',
        value: r => formatCurrency(r.expectedNetUnpaidLoss),
        csvValue: r => roundDollars(r.expectedNetUnpaidLoss),
      },
      {
        key: 'indicatedNetReserveAtConfidenceLevel',
        category: 'Reserves',
        label: 'Indicated Net Reserve at Confidence',
        value: r => formatCurrency(r.indicatedNetReserveAtConfidenceLevel),
        csvValue: r => roundDollars(r.indicatedNetReserveAtConfidenceLevel),
      },
      {
        key: 'reserveRiskMarginNeeded',
        category: 'Reserves',
        label: 'Reserve Risk Margin Needed',
        value: r => formatCurrency(r.reserveRiskMarginNeeded),
        csvValue: r => roundDollars(r.reserveRiskMarginNeeded),
      },

      // Balance sheet and surplus
      {
        key: 'beginningCash',
        category: 'Balance Sheet and Surplus',
        label: 'Beginning Cash',
        value: r => formatCurrency(r.beginningCash),
        csvValue: r => roundDollars(r.beginningCash),
      },
      {
        key: 'endingCash',
        category: 'Balance Sheet and Surplus',
        label: 'Ending Cash',
        value: r => formatCurrency(r.endingCash),
        csvValue: r => roundDollars(r.endingCash),
      },
      {
        key: 'beginningInvestments',
        category: 'Balance Sheet and Surplus',
        label: 'Beginning Investments',
        value: r => formatCurrency(r.beginningInvestments),
        csvValue: r => roundDollars(r.beginningInvestments),
      },
      {
        key: 'endingInvestments',
        category: 'Balance Sheet and Surplus',
        label: 'Ending Investments',
        value: r => formatCurrency(r.endingInvestments),
        csvValue: r => roundDollars(r.endingInvestments),
      },
      {
        key: 'otherAssets',
        category: 'Balance Sheet and Surplus',
        label: 'Other Assets',
        value: r => formatCurrency(r.otherAssets),
        csvValue: r => roundDollars(r.otherAssets),
      },
      {
        key: 'totalAssets',
        category: 'Balance Sheet and Surplus',
        label: 'Total Assets',
        value: r => formatCurrency(r.totalAssets),
        csvValue: r => roundDollars(r.totalAssets),
      },
      {
        key: 'unearnedPremium',
        category: 'Balance Sheet and Surplus',
        label: 'Unearned Premium',
        value: r => formatCurrency(r.unearnedPremium),
        csvValue: r => roundDollars(r.unearnedPremium),
      },
      {
        key: 'otherLiabilities',
        category: 'Balance Sheet and Surplus',
        label: 'Other Liabilities',
        value: r => formatCurrency(r.otherLiabilities),
        csvValue: r => roundDollars(r.otherLiabilities),
      },
      {
        key: 'totalLiabilities',
        category: 'Balance Sheet and Surplus',
        label: 'Total Liabilities',
        value: r => formatCurrency(r.totalLiabilities),
        csvValue: r => roundDollars(r.totalLiabilities),
      },
      {
        key: 'beginingSurplus',
        category: 'Balance Sheet and Surplus',
        label: 'Beginning Surplus',
        value: r => formatCurrency(r.beginingSurplus),
        csvValue: r => roundDollars(r.beginingSurplus),
      },
      {
        key: 'surplusFromIncome',
        category: 'Balance Sheet and Surplus',
        label: 'Surplus from Income',
        value: r => formatCurrency(r.surplusFromIncome),
        csvValue: r => roundDollars(r.surplusFromIncome),
      },
      {
        key: 'endingSurplus',
        category: 'Balance Sheet and Surplus',
        label: 'Ending Surplus',
        value: r => formatCurrency(r.endingSurplus),
        csvValue: r => roundDollars(r.endingSurplus),
      },
      {
        key: 'surplusTieOutDifference',
        category: 'Balance Sheet and Surplus',
        label: 'Surplus Tie-Out Difference',
        value: r => formatCurrency(r.surplusTieOutDifference),
        csvValue: r => roundDollars(r.surplusTieOutDifference),
      },

      // Ratios and capital
      {
        key: 'expectedLossRatio',
        category: 'Ratios and Capital',
        label: 'Expected Loss Ratio',
        value: r => formatPct(r.expectedLossRatio),
        csvValue: r => r.expectedLossRatio,
      },
      {
        key: 'expectedExpenseRatio',
        category: 'Ratios and Capital',
        label: 'Expected Expense Ratio',
        value: r => formatPct(r.expectedExpenseRatio),
        csvValue: r => r.expectedExpenseRatio,
      },
      {
        key: 'expectedCombinedRatio',
        category: 'Ratios and Capital',
        label: 'Expected Combined Ratio',
        value: r => formatPct(r.expectedCombinedRatio),
        csvValue: r => r.expectedCombinedRatio,
      },
      {
        key: 'actualLossRatio',
        category: 'Ratios and Capital',
        label: 'Actual Loss Ratio',
        value: r => formatPct(r.actualLossRatio),
        csvValue: r => r.actualLossRatio,
      },
      {
        key: 'actualExpenseRatio',
        category: 'Ratios and Capital',
        label: 'Actual Expense Ratio',
        value: r => formatPct(r.actualExpenseRatio),
        csvValue: r => r.actualExpenseRatio,
      },
      {
        key: 'actualCombinedRatio',
        category: 'Ratios and Capital',
        label: 'Actual Combined Ratio',
        value: r => formatPct(r.actualCombinedRatio),
        csvValue: r => r.actualCombinedRatio,
      },
      {
        key: 'availableSurplus',
        category: 'Ratios and Capital',
        label: 'Surplus',
        value: r => formatCurrency(r.availableSurplus),
        csvValue: r => roundDollars(r.availableSurplus),
      },
      {
        key: 'excessAvailableSurplus',
        category: 'Ratios and Capital',
        label: 'Excess Available Surplus',
        value: r => formatCurrency(r.excessAvailableSurplus),
        csvValue: r => roundDollars(r.excessAvailableSurplus),
      },
      {
        key: 'excessCapitalRatio',
        category: 'Ratios and Capital',
        label: 'Excess Capital Ratio',
        value: r => r.excessCapitalRatio === null ? 'N/A' : r.excessCapitalRatio.toFixed(3),
        csvValue: r => r.excessCapitalRatio ?? '',
      },
      {
        key: 'capitalAdequacyStatus',
        category: 'Ratios and Capital',
        label: 'Excess Capital Status',
        value: r => r.capitalAdequacyStatus,
      },
    ];
  }, []);

  const memberRows = useMemo(() => {
    if (!selectedResult?.memberList) return [];

    const lossByMember = new Map(
      (selectedResult.memberLossResults ?? []).map(loss => [loss.memberId, loss])
    );

    return selectedResult.memberList.map(member => {
      const record = member as unknown as Record<string, unknown>;
      const loss = lossByMember.get(member.id);

      return {
        id: safeCell(record.id),
        name: safeCell(record.name),
        status: safeCell(record.status),
        size: safeCell(record.sizeCategory),
        exposure: safeNumber(getMemberExposure(member, 'WC')),
        riskQuality: safeNumber(record.riskQuality),
        satisfaction: safeNumber(record.satisfaction),
        expectedLoss: loss ? formatCurrency(loss.expectedLoss) : '',
        coefficientOfVariation: loss ? formatPct(loss.coefficientOfVariation) : '',
        standardDeviation: loss ? formatCurrency(loss.standardDeviation) : '',
        simulatedLoss: loss ? formatCurrency(loss.simulatedLoss) : '',
      };
    });
  }, [selectedResult]);

  if (lockedResults.length === 0) {
    return (
      <div className="max-w-screen-2xl mx-auto px-4 py-6">
        <div className="text-center py-20 text-gray-400">
          <Table size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium text-lg">No spreadsheet data yet</p>
          <p className="text-sm mt-1">Complete a year to populate the result spreadsheet.</p>
        </div>
      </div>
    );
  }

  const resultCsv = buildVerticalResultCsv(lockedResults, resultMetrics);
  const memberCsv = buildMemberCsv(selectedResult);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Result Spreadsheet</h2>
          <p className="text-gray-500 text-sm">
            Vertical year-by-year result table for reviewing seeds, testing decisions, and exporting results.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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

          <button
            type="button"
            onClick={() => downloadCsv('source-game-year-results-vertical.csv', resultCsv)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Download size={16} />
            Download Results CSV
          </button>

          <button
            type="button"
            onClick={() => downloadCsv(`source-game-members-year-${selectedYear}.csv`, memberCsv)}
            disabled={!selectedResult || memberRows.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            Download Members CSV
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="font-bold text-amber-800 text-sm">Testing Tool</p>
        <p className="text-amber-700 text-sm mt-1">
          This page is meant for model testing. The main results now show metrics vertically, with each completed year shown as a separate column.
        </p>
      </div>

      <VerticalResultTable
        title="Year-by-Year Results"
        icon={<ClipboardList size={16} />}
        metrics={resultMetrics}
        results={lockedResults}
      />

      <SpreadsheetTable
        title={`Active Member Roster — Year ${selectedYear}`}
        icon={<Users size={16} />}
        columns={[
          'Member ID',
          'Name',
          'Status',
          'Size',
          'Payroll Exposure ($M)',
          'Risk Quality',
          'Satisfaction',
          'Expected Loss',
          'Loss CV',
          'Loss Standard Deviation',
          'Simulated Actual Loss',
        ]}
        rows={memberRows.map(member => [
          member.id,
          member.name,
          member.status,
          member.size,
          member.exposure,
          member.riskQuality,
          member.satisfaction,
          member.expectedLoss,
          member.coefficientOfVariation,
          member.standardDeviation,
          member.simulatedLoss,
        ])}
        emptyMessage="No member roster saved for this year."
      />
    </div>
  );
}

function VerticalResultTable({
  title,
  icon,
  metrics,
  results,
}: {
  title: string;
  icon: React.ReactNode;
  metrics: SpreadsheetMetric[];
  results: ResultSet[];
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>

      {results.length === 0 ? (
        <div className="p-6 text-sm text-gray-500">No rows available.</div>
      ) : (
        <div className="overflow-auto max-h-[720px]">
          <table className="min-w-max text-xs border-collapse">
            <thead className="sticky top-0 z-30 bg-gray-100">
              <tr>
                <th className="sticky left-0 z-40 border border-gray-200 bg-gray-100 px-3 py-2 text-left font-bold text-gray-700 whitespace-nowrap">
                  Category
                </th>
                <th className="sticky left-[150px] z-40 border border-gray-200 bg-gray-100 px-3 py-2 text-left font-bold text-gray-700 whitespace-nowrap min-w-[260px]">
                  Metric
                </th>
                {results.map(result => (
                  <th
                    key={`year-header-${result.yearNumber}`}
                    className="border border-gray-200 px-3 py-2 text-right font-bold text-gray-700 whitespace-nowrap"
                  >
                    Year {result.yearNumber}
                    <span className="block text-[10px] font-medium text-gray-500">
                      {result.calendarYear}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {metrics.map((metric, rowIndex) => {
                const previousCategory = rowIndex > 0 ? metrics[rowIndex - 1].category : '';
                const startsNewCategory = metric.category !== previousCategory;

                return (
                  <tr
                    key={metric.key}
                    className={startsNewCategory ? 'bg-blue-50/60' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td
                      className={`sticky left-0 z-20 border border-gray-100 px-3 py-2 text-gray-700 whitespace-nowrap min-w-[150px] ${
                        startsNewCategory ? 'bg-blue-50 font-bold text-blue-900' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      {startsNewCategory ? metric.category : ''}
                    </td>
                    <td
                      className={`sticky left-[150px] z-20 border border-gray-100 px-3 py-2 font-semibold text-gray-800 whitespace-nowrap min-w-[260px] ${
                        startsNewCategory ? 'bg-blue-50 text-blue-900' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      {metric.label}
                    </td>
                    {results.map(result => (
                      <td
                        key={`${metric.key}-year-${result.yearNumber}`}
                        className="border border-gray-100 px-3 py-2 text-right font-mono text-gray-800 whitespace-nowrap"
                      >
                        {String(metric.value(result))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SpreadsheetTable({
  title,
  icon,
  columns,
  rows,
  stickyFirstColumn = false,
  emptyMessage = 'No rows available.',
}: {
  title: string;
  icon: React.ReactNode;
  columns: string[];
  rows: string[][];
  stickyFirstColumn?: boolean;
  emptyMessage?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-sm text-gray-500">{emptyMessage}</div>
      ) : (
        <div className="overflow-auto max-h-[640px]">
          <table className="min-w-max text-xs border-collapse">
            <thead className="sticky top-0 z-20 bg-gray-100">
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={`${column}-${index}`}
                    className={`border border-gray-200 px-3 py-2 text-left font-bold text-gray-700 whitespace-nowrap ${
                      stickyFirstColumn && index === 0 ? 'sticky left-0 z-30 bg-gray-100' : ''
                    }`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className={`border border-gray-100 px-3 py-2 text-gray-800 whitespace-nowrap ${
                        stickyFirstColumn && cellIndex === 0
                          ? rowIndex % 2 === 0
                            ? 'sticky left-0 z-10 bg-white font-semibold'
                            : 'sticky left-0 z-10 bg-gray-50 font-semibold'
                          : ''
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function buildVerticalResultCsv(results: ResultSet[], metrics: SpreadsheetMetric[]): string {
  const header = [
    escapeCsv('Category'),
    escapeCsv('Metric'),
    ...results.map(result => escapeCsv(`Year ${result.yearNumber} / ${result.calendarYear}`)),
  ].join(',');

  const rows = metrics.map(metric => {
    const cells = [
      escapeCsv(metric.category),
      escapeCsv(metric.label),
      ...results.map(result => {
        const value = metric.csvValue ? metric.csvValue(result) : metric.value(result);
        return escapeCsv(value);
      }),
    ];

    return cells.join(',');
  });

  return [header, ...rows].join('\n');
}

function buildMemberCsv(result: ResultSet | undefined): string {
  if (!result?.memberList || result.memberList.length === 0) {
    return 'Member ID,Name,Status,Size,Payroll Exposure ($M),Risk Quality,Satisfaction,Expected Loss,Loss CV,Loss Standard Deviation,Simulated Actual Loss';
  }

  const lossByMember = new Map(
    (result.memberLossResults ?? []).map(loss => [loss.memberId, loss])
  );

  const header = [
    'Member ID',
    'Name',
    'Status',
    'Size',
    'Payroll Exposure ($M)',
    'Risk Quality',
    'Satisfaction',
    'Expected Loss',
    'Loss CV',
    'Loss Standard Deviation',
    'Simulated Actual Loss',
  ];

  const rows = result.memberList.map(member => {
    const record = member as unknown as Record<string, unknown>;
    const loss = lossByMember.get(member.id);

    return [
      safeCell(record.id),
      safeCell(record.name),
      safeCell(record.status),
      safeCell(record.sizeCategory),
      safeNumber(getMemberExposure(member, 'WC')),
      safeNumber(record.riskQuality),
      safeNumber(record.satisfaction),
      loss ? Math.round(loss.expectedLoss) : '',
      loss ? loss.coefficientOfVariation : '',
      loss ? Math.round(loss.standardDeviation) : '',
      loss ? Math.round(loss.simulatedLoss) : '',
    ].map(escapeCsv).join(',');
  });

  return [header.map(escapeCsv).join(','), ...rows].join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? '');
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

function roundDollars(value: number): number {
  return Math.round(value);
}

function safeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function safeNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value.toFixed(2);
}
