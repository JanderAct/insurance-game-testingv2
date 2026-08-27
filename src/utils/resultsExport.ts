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
    writtenExposure: 'Written TIV ($M)',
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

// ============================================================================
// NUMBER FORMATS, DERIVED PER ROW BECAUSE THE RESULTS SHEETS ARE ROW-WISE.
//
// ⚠ THE FORMAT BELONGS TO THE ROW HERE, AND TO THE COLUMN IN claimsExport. Pool
// and line sheets put ONE QUANTITY PER ROW and a year per column, so a
// per-column rule would format the Gross Premium row and the Loss Ratio row
// identically. The claims sheets are transposed and take the opposite rule.
//
// ⚠ DERIVED FROM THE METRIC'S OWN RENDERER, NOT FROM A TABLE OF KEYS. Every
// metric already carries `value()`, which is exactly how that number is shown on
// screen — `formatCurrency` gives "$1,234", `formatPct` gives "12.3%", the rest
// give a plain numeral. Reading the bucket off that makes the workbook agree
// with the screen BY CONSTRUCTION and, more importantly, means a metric added
// later gets its format from its own renderer instead of silently landing in a
// default bucket because nobody remembered a second list. A key table is the
// shape of defect this project keeps finding: two descriptions of one fact,
// drifting apart.
//
// ⚠ ANYTHING UNCLASSIFIABLE IS REPORTED, NOT DEFAULTED. classifyMetricFormat
// returns undefined and solo-export-guard's companion check counts it, so a
// numeric row left General shows up as a number rather than as a silently
// General column.
//
// THE BUCKETS
//   #,##0     dollars — anything `value()` renders with a leading $
//   0.00%     percentages — anything `value()` renders with a trailing %. The
//             ENGINE STORES THESE AS FRACTIONS (marketShare 0.3012,
//             actualLossRatio 1.7392) and Excel's percent format multiplies by
//             100 on DISPLAY only, so nothing is multiplied here and the cell
//             still holds the fraction. Verified by round-trip.
//   #,##0.00  everything else numeric — ratios, multipliers, counts, factors
//   0         years, which must not gain a thousands separator: 2026, not 2,026
// ============================================================================
export type NumFmt = '#,##0' | '#,##0.00' | '0.00%' | '0';

// ⚠ THE ONLY KEYS NAMED EXPLICITLY, because a year renders as a bare numeral and
// is indistinguishable from a count by its rendering alone.
const YEAR_KEYS = new Set(['yearNumber', 'calendarYear']);

// The value actually written to the cell — csvValue when present, else value.
// Only a cell that lands as a NUMBER can carry a number format.
const writtenValue = (m: SpreadsheetMetric, r: LineResultSet) =>
  (m.csvValue ? m.csvValue(r) : m.value(r));

export function classifyMetricFormat(metric: SpreadsheetMetric, results: LineResultSet[]): NumFmt | undefined {
  if (results.length === 0) return undefined;
  if (YEAR_KEYS.has(metric.key)) return '0';
  // A row whose cells are all text needs no format, and must not be given one.
  if (!results.some(r => typeof writtenValue(metric, r) === 'number')) return undefined;

  // Probe every year, not just the first: excessCapitalRatio renders 'N/A' when
  // the margin is zero and a numeral otherwise, so one sample can be blank on a
  // row that is numeric everywhere else.
  for (const r of results) {
    const shown = metric.value(r);
    if (typeof shown === 'number') return '#,##0.00';
    const t = String(shown).trim();
    // A composite string that merely CONTAINS % — the asset-allocation summary
    // ends with one — is not a percentage. Anchored on both ends for that reason.
    if (/^-?[\d,]+(\.\d+)?%$/.test(t)) return '0.00%';
    // ⚠ A DOLLAR SIGN WITH DECIMALS IS A RATE, NOT AN AMOUNT, and the renderer
    // already separates the two: formatCurrency emits whole dollars ("$1,234"),
    // the `dollars` helper emits cents ("$1.23") and is used only for the
    // per-$100 rates. Those are STORED AT 4dp precisely because their precision
    // is load-bearing — see the QUANTUM table in audit-formula-check — so
    // rounding them to whole dollars would show "$1" for a rate whose whole
    // meaning is in the digits after the point. They take the two-decimal
    // bucket: a rate per $100 of payroll is a rate, and the column label already
    // carries the unit.
    if (/^-?\$[\d,]+\.\d+$/.test(t)) return '#,##0.00';
    if (/^-?\$[\d,]+$/.test(t)) return '#,##0';
    if (/^-?[\d,]+(\.\d+)?$/.test(t)) return '#,##0.00';
  }
  return undefined;
}

// ⚠ FORMAT ONLY. `z` is the number format; `v`, the stored value, is untouched,
// so a cell showing 42,709,940 still holds 42709939.61 and a column re-summed in
// Excel agrees with the engine rather than with its own displayed rounding.
// Skips any cell that did not land as a number, so a text cell on a numeric row
// stays text.
function applyRowFormats(ws: XLSX.WorkSheet, formats: (NumFmt | undefined)[]): void {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let i = 0; i < formats.length; i++) {
    const fmt = formats[i];
    if (!fmt) continue;
    const r = i + 1;            // row 0 is the header
    // Columns 0 and 1 are Category and Metric — always text.
    for (let c = 2; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.z = fmt;
    }
  }
}

function sheetFor(results: LineResultSet[], metrics: SpreadsheetMetric[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(buildAoaRows(results, metrics));
  applyRowFormats(ws, metrics.map(m => classifyMetricFormat(m, results)));
  return ws;
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

  XLSX.utils.book_append_sheet(
    wb, sheetFor(lockedResults, buildPoolMetrics(baseMetrics, activeLines)), 'Pool');

  for (const line of orderedLines) {
    const lineResults = lockedResults.map(r => r.byLine[line]);
    XLSX.utils.book_append_sheet(
      wb, sheetFor(lineResults, buildLineMetrics(baseMetrics, line)), line);
  }

  // SHOCK EVENTS — a sheet, and ONLY WHEN AT LEAST ONE FIRED.
  //
  // Deliberately NOT a RESULT_METRICS entry. That list is static, so any metric
  // added to it renders a row for every year of every game, which would move
  // every hash in solo-export-guard whether or not a shock ever fires. A whole
  // sheet that simply does not exist when the array is empty leaves the sheet
  // join byte-identical, so a shock-free game exports exactly what it always
  // did. This is the difference between a green gate and a week of confusion.
  const shockRows = buildShockRows(lockedResults);
  if (shockRows.length > 1) {
    const ws = XLSX.utils.aoa_to_sheet(shockRows);
    // COLUMN-WISE, like the claims sheets: Year, Calendar Year, Event, Name,
    // Band, Horizon, Year Fired, Lines, Attributable Gross Loss, Attributable
    // Claims, Expected Gross Loss Added, Effects, Description.
    const fmts: (NumFmt | undefined)[] = [
      '0', '0', undefined, undefined, undefined, '#,##0.00', '0', undefined,
      '#,##0', '#,##0.00', '#,##0', undefined, undefined,
    ];
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    for (let c = 0; c < fmts.length; c++) {
      if (!fmts[c]) continue;
      for (let r = 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.t === 'n') cell.z = fmts[c];
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, 'Shock Events');
  }

  return wb;
}

// One row per event per year, or just the header when nothing fired (in which
// case the caller drops the sheet entirely).
function buildShockRows(lockedResults: ResultSet[]): (string | number)[][] {
  const rows: (string | number)[][] = [[
    'Year', 'Calendar Year', 'Event', 'Name', 'Band', 'Horizon', 'Year Fired', 'Lines',
    'Attributable Gross Loss', 'Attributable Claims', 'Expected Gross Loss Added', 'Effects', 'Description',
  ]];
  for (const r of lockedResults) {
    for (const s of r.shockEvents ?? []) {
      rows.push([
        r.yearNumber, r.calendarYear, s.shockId, s.name, s.band, s.horizon, s.yearFired,
        s.linesAffected.join(' + '),
        Math.round(s.attributableGrossLoss), s.attributableClaims, Math.round(s.expectedGrossLossAdded),
        s.effects.map(e => e.detail).join('; '), s.description,
      ]);
    }
  }
  return rows;
}

export function buildExportFilename(instanceId: string, activeLines: CoverageLine[], lockedResults: ResultSet[]): string {
  const lineTag = FIXED_LINE_ORDER.filter(l => activeLines.includes(l)).map(l => LINE_ABBREV[l]).join('_');
  const latestYear = lockedResults[lockedResults.length - 1]?.yearNumber ?? 0;
  return `SEED_${instanceId}_${lineTag}_YR${latestYear}.xlsx`;
}
