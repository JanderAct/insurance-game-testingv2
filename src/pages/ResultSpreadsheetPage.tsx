import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, ClipboardList, Table, Users } from 'lucide-react';
import type { CoverageLine, ResultSet, PoolState } from '../types/simulation';
import { formatCurrency, formatPct } from '../utils/formatters';
import { getMemberExposure } from '../utils/lineHelpers';
import { type SpreadsheetMetric, buildResultsWorkbook, buildExportFilename } from '../utils/resultsExport';
import { buildClaimsWorkbook, buildClaimsExportFilename } from '../utils/claimsExport';
import { RESULT_METRICS } from '../utils/resultMetrics';

interface ResultSpreadsheetPageProps {
  lockedResults: ResultSet[];
  // The pre-game bootstrap's three years. Accident years -2, -1 and 0 have real
  // claim registers and belong on the claims workbook's line sheets; without
  // this they were absent from the sheets while their development sat on the
  // Development sheet, and the workbook disagreed with itself.
  priorHistory: ResultSet[];
  activeLines: CoverageLine[];
  instanceId: string;
  // Current pool state, for the claims workbook's Development sheet. The
  // developing claims live on the reserve cohorts, not on a locked result.
  poolState: PoolState;
}

export default function ResultSpreadsheetPage({ lockedResults, priorHistory, activeLines, instanceId, poolState }: ResultSpreadsheetPageProps) {
  const [selectedYear, setSelectedYear] = useState<number>(
    lockedResults.length > 0 ? lockedResults[lockedResults.length - 1].yearNumber : 1
  );

  const selectedResult = lockedResults.find(r => r.yearNumber === selectedYear);

  const resultMetrics = RESULT_METRICS;

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
        // NOMINAL, in the dollars of the year being viewed — matching that
        // year's premium. Roster payroll is frozen in year-1 dollars.
        exposure: safeNumber(getMemberExposure(member, 'WC', selectedResult.yearNumber)),
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

  const memberCsv = buildMemberCsv(selectedResult);
  const exportFilename = buildExportFilename(instanceId, activeLines, lockedResults);
  const claimsExportFilename = buildClaimsExportFilename(instanceId, activeLines, lockedResults);

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
            onClick={() => {
              const wb = buildResultsWorkbook(lockedResults, activeLines, resultMetrics);
              XLSX.writeFile(wb, exportFilename);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Download size={16} />
            Download Results (.xlsx)
          </button>

          <button
            type="button"
            onClick={() => {
              // A SEPARATE workbook, deliberately — see claimsExport.ts. The
              // results workbook above is a per-metric summary; claim-level
              // detail is thousands of rows and does not belong bolted onto it.
              const wb = buildClaimsWorkbook(lockedResults, priorHistory, activeLines, poolState, instanceId);
              XLSX.writeFile(wb, claimsExportFilename);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <Download size={16} />
            Download Claims (.xlsx)
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
      safeNumber(getMemberExposure(member, 'WC', result.yearNumber)),
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

function safeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function safeNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value.toFixed(2);
}
