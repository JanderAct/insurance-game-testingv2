// Stage 2.8: multi-tab .xlsx results export. Pure, React-free helpers so they
// can be reused by the export button and unit-tested directly. One tab per
// active line (fixed order WC, GL, Property) plus a Pool tab, built from the
// SAME metrics list used on-screen — no separate per-tab metric logic to keep
// in sync.
import * as XLSX from 'xlsx';
import type { CoverageLine, LineResultSet, ResultSet } from '../types/simulation';
import { formatPct } from './formatters';

// SpreadsheetMetric functions are typed against LineResultSet (the smaller
// shape) so the SAME metric list works for both the Pool tab (ResultSet[],
// which is a structural superset) and each line's tab (LineResultSet[]).
export interface SpreadsheetMetric {
  key: string;
  category: string;
  label: string;
  value: (result: LineResultSet) => string | number;
  csvValue?: (result: LineResultSet) => string | number;
}

// Fixed tab/filename order (Stage 2.8) — active lines only, Property abbreviated PR.
export const FIXED_LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];
export const LINE_ABBREV: Record<CoverageLine, string> = { WC: 'WC', GL: 'GL', Property: 'PR' };

// Exposure-derived rows that don't make sense as a single Pool-tab number once
// Property (TIV $M) can sit alongside WC/GL (Payroll $M) — summing dollars
// across different units is meaningless. Split into one row per active line
// instead (see buildPoolMetrics).
const POOL_SPLIT_EXPOSURE_KEYS = new Set(['activeExposure', 'totalMarketExposure', 'writtenExposure', 'marketShare']);

function exposureUnitLabel(line: CoverageLine): string {
  return line === 'Property' ? 'TIV $M' : 'Payroll $M';
}

// The Pool tab's data source is always the real ResultSet[] (it has byLine),
// even though these metric functions are typed against the narrower
// LineResultSet so they can be shared with the per-line tabs. This cast is
// only ever exercised on Pool-tab rows, where the true shape is guaranteed.
function poolLineSplitMetrics(key: string, category: string, activeLines: CoverageLine[]): SpreadsheetMetric[] {
  const lines = FIXED_LINE_ORDER.filter(l => activeLines.includes(l));
  const byLine = (r: LineResultSet, line: CoverageLine) => (r as unknown as ResultSet).byLine[line];

  switch (key) {
    case 'activeExposure':
      return lines.map(line => ({
        key: `activeExposure_${line}`,
        category,
        label: `Active Exposure — ${line} (${exposureUnitLabel(line)})`,
        value: r => byLine(r, line).activeExposure.toFixed(2),
        csvValue: r => byLine(r, line).activeExposure,
      }));
    case 'totalMarketExposure':
      return lines.map(line => ({
        key: `totalMarketExposure_${line}`,
        category,
        label: `Total Market Exposure — ${line} (${exposureUnitLabel(line)})`,
        value: r => byLine(r, line).totalMarketExposure.toFixed(2),
        csvValue: r => byLine(r, line).totalMarketExposure,
      }));
    case 'writtenExposure':
      return lines.map(line => ({
        key: `writtenExposure_${line}`,
        category,
        label: `Written Exposure — ${line} (${exposureUnitLabel(line)})`,
        value: r => byLine(r, line).writtenExposure.toFixed(2),
        csvValue: r => byLine(r, line).writtenExposure,
      }));
    case 'marketShare':
      return lines.map(line => ({
        key: `marketShare_${line}`,
        category,
        label: `Market Share — ${line}`,
        value: r => formatPct(byLine(r, line).marketShare),
        csvValue: r => byLine(r, line).marketShare,
      }));
    default:
      return [];
  }
}

// Pool tab: drop the Asset Allocation row (no pool-level allocation since
// Stage 2.9 — each line has its own), and split unit-mixing exposure rows
// per line. Every other row (including investment income/return/assets,
// which ARE meaningful summed/blended pool-wide) is unchanged.
export function buildPoolMetrics(baseMetrics: SpreadsheetMetric[], activeLines: CoverageLine[]): SpreadsheetMetric[] {
  const result: SpreadsheetMetric[] = [];
  for (const m of baseMetrics) {
    if (m.key === 'assetAllocation') continue;
    if (POOL_SPLIT_EXPOSURE_KEYS.has(m.key)) {
      result.push(...poolLineSplitMetrics(m.key, m.category, activeLines));
      continue;
    }
    result.push(m);
  }
  return result;
}

// Line tab: relabel Property's payroll-worded rows to TIV, and add an
// Exposure Basis row (every line tab gets one, for consistency) so it's
// immediately clear which unit that tab's exposure figures are in.
export function buildLineMetrics(baseMetrics: SpreadsheetMetric[], line: CoverageLine): SpreadsheetMetric[] {
  const isProperty = line === 'Property';
  const relabel: Record<string, string> = isProperty ? {
    activeExposure: 'Active TIV Exposure ($M)',
    totalMarketExposure: 'Total Market TIV ($M)',
    purePremiumRatePer100: 'Pure Premium Rate per $100 TIV',
  } : {};

  const relabeled = baseMetrics.map(m => relabel[m.key] ? { ...m, label: relabel[m.key] } : m);

  const exposureBasisRow: SpreadsheetMetric = {
    key: 'exposureBasis',
    category: 'Membership',
    label: 'Exposure Basis',
    value: () => isProperty ? 'TIV ($M)' : 'Payroll ($M)',
  };
  const insertAt = relabeled.findIndex(m => m.key === 'activeExposure');
  relabeled.splice(insertAt === -1 ? 0 : insertAt, 0, exposureBasisRow);

  return relabeled;
}

export function buildAoaRows(results: LineResultSet[], metrics: SpreadsheetMetric[]): (string | number)[][] {
  const header = ['Category', 'Metric', ...results.map(r => `Year ${r.yearNumber} / ${r.calendarYear}`)];
  const rows = metrics.map(metric => [
    metric.category,
    metric.label,
    ...results.map(r => (metric.csvValue ? metric.csvValue(r) : metric.value(r))),
  ]);
  return [header, ...rows];
}

export function buildResultsWorkbook(
  lockedResults: ResultSet[],
  activeLines: CoverageLine[],
  baseMetrics: SpreadsheetMetric[]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const orderedLines = FIXED_LINE_ORDER.filter(l => activeLines.includes(l));

  const poolSheet = XLSX.utils.aoa_to_sheet(buildAoaRows(lockedResults, buildPoolMetrics(baseMetrics, activeLines)));
  XLSX.utils.book_append_sheet(wb, poolSheet, 'Pool');

  for (const line of orderedLines) {
    const lineResults = lockedResults.map(r => r.byLine[line]);
    const lineSheet = XLSX.utils.aoa_to_sheet(buildAoaRows(lineResults, buildLineMetrics(baseMetrics, line)));
    XLSX.utils.book_append_sheet(wb, lineSheet, line);
  }

  return wb;
}

export function buildExportFilename(instanceId: string, activeLines: CoverageLine[], lockedResults: ResultSet[]): string {
  const lineTag = FIXED_LINE_ORDER.filter(l => activeLines.includes(l)).map(l => LINE_ABBREV[l]).join('_');
  const latestYear = lockedResults[lockedResults.length - 1]?.yearNumber ?? 0;
  return `SEED_${instanceId}_${lineTag}_YR${latestYear}.xlsx`;
}
