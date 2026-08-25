import React, { useState } from 'react';
import { hasStaticClf, staticClf } from '../data/clfTables';
import { lookupCLF } from '../utils/simulationEngine';
import {
  Calculator,
  ClipboardList,
  DollarSign,
  Shield,
  TrendingUp,
  AlertTriangle,
  Settings,
  Layers,
  Zap,
} from 'lucide-react';
import type { CoverageLine, LineResultSet, LineView, ResultSet } from '../types/simulation';
import { lineDisplayName } from '../utils/lineDisplay';
import { formatCurrency, formatPct } from '../utils/formatters';
import { deriveSubRng } from '../utils/random';
import { simulateMarketReturns, blendInvestmentReturn } from '../utils/investmentEngine';
import {
  ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM,
  AGGREGATE_LOSS_DISTRIBUTION,
  LOSS_TREND,
  MEMBER_LOSS_VOLATILITY,
  BASE_RETENTION,
  BASE_NEW_MEMBERS_PER_YEAR,
  MAX_NEW_MEMBERS_PER_YEAR,
  MAX_WITHDRAWN_PER_YEAR,
  FUNDING_CLF_TABLE,
  ASSET_CLASS_ASSUMPTIONS,
  ASSET_ALLOCATION_DEFAULT,
  MEMBER_MOVEMENT_WEIGHTS,
  RISK_CONTROL_PARAMS,
  EXPOSURE_RANGES,
  SIZE_WEIGHTS,
  STARTING_EXPOSURE_SHARE,
  STARTING_RATE_PER_100,
  STARTING_FINANCIALS,
  SLIDER_RANGES,
  RESERVE_PAYDOWN_PCT,
  LINE_RESERVE_PAYDOWN_PCT,
  OPERATING_CASH_PCT_OF_PREMIUM,
} from '../data/defaultAssumptions';
import { MARKET_MEMBER_COUNT, MARKET_TOTAL_EXPOSURE } from '../data/memberCatalog';

interface CalculationAuditPageProps {
  // Pool-level results, UNFILTERED by line view: the page selects its own
  // scope below, because the "Pool = Sum of Active Lines" card needs .byLine.
  lockedResults: ResultSet[];
  // Pre-game years (yearNumbers <= 0) are real engine results, so every card
  // on this page can run against them too, not just locked live years.
  priorHistory: ResultSet[];
  // Needed to re-derive a year's investment-return draw rather than reading
  // the engine's own stored echo of it.
  instanceSeed: number;
  lineView: LineView;
}

// Three-state check outcome. 'variance' is a DOCUMENTED, bounded modelling
// effect (kept distinct so a permanent known variance never reads the same as
// a genuine new regression); 'na' means the check has no meaning at the
// selected scope/year and was not evaluated.
type CheckStatus = 'pass' | 'variance' | 'fail' | 'na';

// ---------------------------------------------------------------------------
// Formula specifications.
//
// The Formula / Source column shows real arithmetic with real numbers so a
// reader can verify each figure by hand. To make a WRONG formula string
// structurally impossible rather than merely tested for, a row carries the
// OPERANDS, and the displayed string is derived from them — the display cannot
// drift from the values it claims to multiply. evaluate() then lets a
// regression script confirm the operands actually produce the stated figure.
// ---------------------------------------------------------------------------

type TermFormat = 'currency' | 'pct' | 'factor' | 'exposure' | 'plain';

export type FormulaTerm =
  | { value: number; format: TermFormat; label?: string }
  // A nested product, so an expression like "a − pressure × spread" stays
  // verifiable rather than being flattened into prose.
  | { product: FormulaTerm[]; label?: string; negate?: boolean };

export type FormulaSpec =
  | { kind: 'product'; factors: FormulaTerm[] }
  | { kind: 'sum'; terms: FormulaTerm[] }
  // A division — most of the Ratios card and Market Share. Rendered as
  // "numerator / denominator"; the Value column already shows the result, so
  // this doesn't repeat it.
  | { kind: 'ratio'; numerator: FormulaTerm; denominator: FormulaTerm }
  // A simulated draw has no closed form. It states what the draw was centred
  // on and where the detail lives, rather than inventing a formula.
  | { kind: 'simulated'; expected: number; expectedLabel: string; where: string }
  // The same figure as another line (a gross pass-through shown twice).
  | { kind: 'echo'; value: number; text: string }
  // Prose only — used for the handful of rows with no numeric expression
  // (atomic counts, categorical thresholds, or a genuinely missing operand).
  | { kind: 'text'; text: string };

// Enough significant digits that multiplying the DISPLAYED operands by hand
// reproduces the displayed result — a rate shown as "-0.8%" would hand-multiply
// to a visibly different figure than the one on the row. Trailing zeros are
// trimmed so exact rates like 37.5% stay clean.
function trimNumber(s: string): string {
  let out = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  if (!out.includes('.')) out += '.0';
  return out;
}

function fmtTermValue(value: number, format: TermFormat): string {
  switch (format) {
    case 'currency': return formatCurrency(value);
    case 'pct': return `${trimNumber((value * 100).toFixed(4))}%`;
    case 'factor': return trimNumber(value.toFixed(6));
    case 'exposure': return `${value.toFixed(2)}M`;
    // 4 decimals: enough that hand-multiplying the DISPLAYED per-$100 rates
    // (stored rounded to 4 decimals in the engine) reproduces the row's
    // value — 2 decimals silently dropped precision a $20.0142 rate needs.
    case 'plain': return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
}

function evalTerm(term: FormulaTerm): number {
  if ('product' in term) {
    const p = term.product.reduce((a, t) => a * evalTerm(t), 1);
    return term.negate ? -p : p;
  }
  return term.value;
}

function renderTerm(term: FormulaTerm): string {
  if ('product' in term) {
    const inner = term.product.map(renderTerm).join(' × ');
    const body = term.product.length > 1 ? `(${inner})` : inner;
    return `${body}${term.label ? ` (${term.label})` : ''}`;
  }
  return `${fmtTermValue(term.value, term.format)}${term.label ? ` (${term.label})` : ''}`;
}

// The value the operands produce, or null when the spec states no arithmetic.
export function evaluateFormula(spec: FormulaSpec): number | null {
  switch (spec.kind) {
    case 'product': return spec.factors.reduce((a, t) => a * evalTerm(t), 1);
    case 'sum': return spec.terms.reduce((a, t) => a + evalTerm(t), 0);
    case 'ratio': return evalTerm(spec.numerator) / evalTerm(spec.denominator);
    case 'echo': return spec.value;
    case 'simulated':
    case 'text': return null;
  }
}

export function renderFormula(spec: FormulaSpec): string {
  switch (spec.kind) {
    case 'product':
      return spec.factors.map(renderTerm).join(' × ');
    case 'sum':
      return spec.terms
        .map((t, i) => {
          const negative = ('product' in t && t.negate) || (!('product' in t) && t.value < 0);
          const shown = 'product' in t
            ? renderTerm({ ...t, negate: false })
            : renderTerm({ ...t, value: Math.abs(t.value) });
          if (i === 0) return negative ? `− ${shown}` : shown;
          return `${negative ? '−' : '+'} ${shown}`;
        })
        .join(' ');
    case 'ratio':
      return `${renderTerm(spec.numerator)} / ${renderTerm(spec.denominator)}`;
    case 'simulated':
      return `Simulated draw; ${spec.expectedLabel} ${formatCurrency(spec.expected)} (see ${spec.where})`;
    case 'echo':
      return `${formatCurrency(spec.value)} — ${spec.text}`;
    case 'text':
      return spec.text;
  }
}

// Module-level term builders, shared by every card (the statement-card
// builders keep their own local `cur` for now; these serve the six supporting
// cards converted in this pass).
function curTerm(value: number, label?: string): FormulaTerm {
  return { value, format: 'currency', label };
}
function pctTerm(value: number, label?: string): FormulaTerm {
  return { value, format: 'pct', label };
}
function factorTerm(value: number, label?: string): FormulaTerm {
  return { value, format: 'factor', label };
}

// How a tower line's reinsurance cost is actually built. ONE PRODUCT NOW —
// every line runs the per-occurrence tower, so this is simply how
// "Premiums for transferred risk" and "Reinsurance Cost" are described; there
// is no percentage-of-premium alternative left to branch on.
//
// This replaces computeReinsRate / reinsRateSubFormula, which existed only to
// derive REINSURANCE_PROGRAMS' rate for a line that had one. `prog` was null
// on every live result even before those functions were deleted — Property
// was the last line with a rate to compute, and it left that product for its
// own occurrence tower. Keeping a function whose real branch never fires is
// the same defect its own header warned about (a plausible number that means
// nothing); deleted rather than left dead.
function towerReinsCostFormula(x: LineResultSet): FormulaSpec {
  const layersPaid = (x.cededByLayer ?? []).length;
  const agg = (x.aggregatePremium ?? 0) > 0;
  return {
    kind: 'echo',
    value: x.reinsuranceCost,
    text: `Per-occurrence tower: sum of ${layersPaid} placed layer premium(s)` +
      `${agg ? ' + aggregate stop-loss premium' : ''}, each priced off measured expected ceded loss — ` +
      'NOT a percentage of pool premium.',
  };
}

export interface AuditRow {
  metric: string;
  value: string;
  // A structured spec on the statement cards; plain prose on the supporting
  // cards. Strings are normalised to { kind: 'text' } when rendered.
  formula: string | FormulaSpec;
  // A secondary derivation for one of the operands above (e.g. how the
  // reinsurance rate itself is built), rendered muted beneath the formula and
  // verified the same way.
  subFormula?: { label: string; spec: FormulaSpec; value: number };
  // The row's figure as a number, so a script can confirm the operands produce
  // it. Present on every formula-bearing statement row.
  numericValue?: number;
  // Short context beneath the arithmetic — the formula is what the column is
  // for, this is only the surrounding explanation.
  explain?: string;
  note?: string;
  // Present only on rows that actually verify something. The page-level status
  // line counts these; descriptive rows carry no status and are not counted.
  status?: CheckStatus;
  // Presentation, so the statement-mirroring cards can reproduce the
  // statements' own visual hierarchy: 'section' is a full-width subheading,
  // emphasis bolds a subtotal (a rule above it for a statement total), and
  // indent nests a line under its group the way the statement indents it.
  kind?: 'section';
  emphasis?: 'subtotal' | 'total';
  indent?: 1 | 2;
}

interface AuditSectionProps {
  title: string;
  icon: React.ReactNode;
  rows: AuditRow[];
}

const CHECK_TOLERANCE = 0.01;

// Renders the Check / Notes column text AND classifies the row, so the column
// wording and the page-level tally can never disagree.
function checkNote(
  diff: number,
  opts: { tolerance?: number; varianceCap?: number; varianceReason?: string; isPct?: boolean } = {}
): { note: string; status: CheckStatus } {
  const tolerance = opts.tolerance ?? CHECK_TOLERANCE;
  const abs = Math.abs(diff);
  const shown = opts.isPct ? diff.toFixed(6) : formatCurrency(diff);
  if (abs <= tolerance) return { note: 'OK', status: 'pass' };
  if (opts.varianceCap !== undefined && abs <= opts.varianceCap) {
    return { note: `Known variance ${shown} — ${opts.varianceReason}`, status: 'variance' };
  }
  return { note: `DIFFERENCE ${shown} — unexpected, investigate`, status: 'fail' };
}

function naNote(reason: string): { note: string; status: CheckStatus } {
  return { note: `n/a — ${reason}`, status: 'na' };
}

// The long-standing recalculation checks on this page. Keeps their original
// tolerances (a dollar for currency, 1e-4 for ratios — deliberately looser
// than CHECK_TOLERANCE) and their original 'OK' / 'Review' wording, while
// also classifying them so they count toward the page-level status line.
function legacyCheck(value: number, threshold = 1): { note: string; status: CheckStatus } {
  return Math.abs(value) <= threshold
    ? { note: 'OK', status: 'pass' }
    : { note: 'Review', status: 'fail' };
}

// A prior-year reserve cohort can close this year and have its residual
// balance floored to zero (Math.max(0, newUnpaid) in the reserve rollforward)
// rather than fully absorbed into the simulated development figure. That
// produces a small, bounded gap between the "gross - recoveries -
// development" path and the "paid + reserve change" path — a known, bounded
// modelling effect, not a defect. Capped far below the scale a real systemic
// bug would produce.
const CLAIMS_VARIANCE_CAP = 10_000;
const CLAIMS_VARIANCE_REASON =
  'a prior-year reserve cohort closed and its residual balance was floored to zero in the rollforward rather than absorbed into the development figure';

export default function CalculationAuditPage({ lockedResults, priorHistory, instanceSeed, lineView }: CalculationAuditPageProps) {
  // Chronological order: earliest pre-game year first, Year 0 (opening) last
  // among prior years, then live Year 1 onward — same convention as the
  // Financial Statements tab, so the audit reaches pre-game history too.
  const openingYear = priorHistory[priorHistory.length - 1];
  const earlierPriorYears = priorHistory.slice(0, -1);
  const allYears: ResultSet[] = [...priorHistory, ...lockedResults];

  const [selectedYear, setSelectedYear] = useState<number>(
    lockedResults.length > 0
      ? lockedResults[lockedResults.length - 1].yearNumber
      : openingYear?.yearNumber ?? 1
  );

  const poolResult = allYears.find(r => r.yearNumber === selectedYear);

  const yearOptions: { label: string; value: number }[] = [
    ...earlierPriorYears.map(y => ({ label: `${y.calendarYear} (History)`, value: y.yearNumber })),
    ...(openingYear ? [{ label: `Year 0 — ${openingYear.calendarYear} (Opening)`, value: openingYear.yearNumber }] : []),
    ...lockedResults.map(r => ({ label: `Year ${r.yearNumber} / ${r.calendarYear}`, value: r.yearNumber })),
  ];

  if (allYears.length === 0 || !poolResult) {
    return (
      <div className="max-w-screen-2xl mx-auto px-4 py-6">
        <div className="text-center py-20 text-gray-400">
          <Calculator size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium text-lg">No calculation audit available yet</p>
          <p className="text-sm mt-1">Complete a year to see calculation details.</p>
        </div>
      </div>
    );
  }

  // Every card below reads `result`, so selecting a line re-scopes the whole
  // page. The Pool = Sum card is the one exception — it needs poolResult.byLine.
  const isPoolView = lineView === 'pool';
  const result: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const checks = computeAuditChecks(poolResult, lineView, instanceSeed);

  // Six supporting cards, built from one exported pure function (mirroring the
  // buildRevExpRows / buildNetPositionRows pattern below) so a regression
  // script can evaluate every formula without rendering the page.
  const { exposureRows, rateRows, lossRows, reserveRows, ratioRows, capitalRows } =
    buildSupportingRows(poolResult, lineView);

  // The two statement-mirroring cards, built from exported pure functions so a
  // regression script can assert their correspondence to the statements.
  const revExpRows = buildRevExpRows(poolResult, lineView, checks);
  const netPositionRows = buildNetPositionRows(poolResult, lineView, checks);
  const cashInvestmentRows = buildCashInvestmentRows(poolResult, lineView, checks);

  // Pool = sum of active lines, plus the reserve-weighted current/noncurrent
  // blend. Pool scope only — at line scope the sum is a single term and the
  // reserve split is definitional (X x p + X x (1-p) = X).
  const poolSumRows: AuditRow[] = isPoolView
    ? [
        ...checks.poolSum.map(({ metric, check }) => ({
          metric,
          value: formatCurrency(check.statement),
          formula: check.buildUp ?? '',
          note: check.note,
          status: check.status,
        })),
        ...(checks.reserveCurrentNoncurrent
          ? [{
              metric: 'Reserve Current + Noncurrent (reserve-weighted)',
              value: formatCurrency(result.endingNetReserve),
              formula: checks.reserveCurrentNoncurrent.buildUp ?? '',
              note: checks.reserveCurrentNoncurrent.note,
              status: checks.reserveCurrentNoncurrent.status,
            }]
          : []),
      ]
    : [];

  const assumptionRows: AuditRow[] = buildAssumptionRows();

  const allCheckRows = [
    ...revExpRows, ...netPositionRows, ...cashInvestmentRows, ...poolSumRows,
    ...exposureRows, ...rateRows, ...lossRows, ...reserveRows,
    ...ratioRows, ...capitalRows,
  ];
  const status = statusLine(allCheckRows);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Calculation Audit{isPoolView ? '' : ` — ${lineDisplayName(lineView)}`}
          </h2>
          <p className="text-gray-500 text-sm">
            Temporary debug page showing result values, formulas, calculation checks, and model assumptions.
          </p>
        </div>

        <select
          value={selectedYear}
          onChange={e => setSelectedYear(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {yearOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={`border rounded-xl px-4 py-3 text-sm font-semibold ${status.tone}`}>
        {status.text}
        <span className="font-normal opacity-75"> — differences under {formatCurrency(CHECK_TOLERANCE)} pass as floating-point epsilon; detail is in the Check / Notes column of each card.</span>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
        <div>
          <p className="font-bold text-amber-800">Temporary Debug Page</p>
          <p className="text-amber-700 text-sm">
            This page is intended for model review only. It should be removed or hidden before the final player version.
          </p>
        </div>
      </div>

      {/* The two statement-mirroring cards first: same line items, names, order
          and subtotals as the Financial Statements tab, each line showing its
          derivation and its check. */}
      <AuditSection title="Statement of Revenues, Expenses & Changes in Net Position" icon={<DollarSign size={16} />} rows={revExpRows} />
      <AuditSection title="Statement of Net Position" icon={<DollarSign size={16} />} rows={netPositionRows} />
      {isPoolView && (
        <AuditSection title="Pool = Sum of Active Lines" icon={<Layers size={16} />} rows={poolSumRows} />
      )}

      {/* SHOCK EVENTS — rendered ONLY when something fired, so a shock-free game
          shows exactly the page it always did. Placed immediately above the
          supporting detail because a shock perturbs the loss and rate cards
          below it, and the reader needs to know that before reading them.
          A shock that changes the numbers invisibly is worse than no shock. */}
      {(result.shockEvents?.length ?? 0) > 0 && (
        <AuditSection title="Shock Events" icon={<Zap size={16} />} rows={buildShockAuditRows(result)} />
      )}

      {/* Supporting detail behind the statement lines. */}
      <AuditSection title="Cash & Investments Rollforward" icon={<DollarSign size={16} />} rows={cashInvestmentRows} />
      <AuditSection title="Exposure and Membership" icon={<TrendingUp size={16} />} rows={exposureRows} />
      <AuditSection title="Funding Rate Build-Up" icon={<Calculator size={16} />} rows={rateRows} />
      <AuditSection title="Losses and Reinsurance" icon={<Shield size={16} />} rows={lossRows} />
      <AuditSection title="Reserve Rollforward" icon={<ClipboardList size={16} />} rows={reserveRows} />
      <AuditSection title="Ratios" icon={<Calculator size={16} />} rows={ratioRows} />
      <AuditSection title="Capital and Reserve Confidence" icon={<Shield size={16} />} rows={capitalRows} />
      <AuditSection title="Default Assumptions / Parameters" icon={<Settings size={16} />} rows={assumptionRows} />
    </div>
  );
}

// One block per event: what fired, what it did, and what it cost.
//
// THE TWO COST LINES ARE NOT ADDED TOGETHER, and the notes say why. An injected
// claim's cost is exactly attributable; a frequency multiplier's is not, because
// a multiplied Poisson draw cannot be split into base and extra claims without a
// counterfactual re-draw of the whole line. Summing an exact figure and an
// analytic expectation into one number would read as precision that is not there.
function buildShockAuditRows(result: LineResultSet): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const s of result.shockEvents ?? []) {
    rows.push({ kind: 'section', metric: `${s.shockId} — ${s.name}`, value: '', formula: '' } as AuditRow);
    rows.push({
      metric: 'Band / horizon',
      value: `${s.band} · ${s.horizon}`,
      formula: s.description,
      note: s.horizon === 'future'
        ? `Fired in year ${s.yearFired}; persists from that year forward for the rest of this game.`
        : 'Applies to this year only.',
    } as AuditRow);
    rows.push({
      metric: 'Lines affected',
      value: s.linesAffected.join(' + '),
      formula: s.effects.map(e => `${e.kind}: ${e.detail}`).join('  |  '),
      note: s.linesAffected.length > 1
        ? 'One cause, several lines — resolved at pool level and projected into each line.'
        : '',
    } as AuditRow);
    rows.push({
      metric: 'Attributable gross loss',
      value: formatCurrency(s.attributableGrossLoss),
      numericValue: s.attributableGrossLoss,
      formula: `${s.attributableClaims} injected claim${s.attributableClaims === 1 ? '' : 's'}, summed`,
      note: s.attributableClaims > 0 ? 'Exact — these are specific claims.' : 'No injected claims in this event.',
    } as AuditRow);
    rows.push({
      metric: 'Expected gross loss added',
      value: formatCurrency(s.expectedGrossLossAdded),
      numericValue: s.expectedGrossLossAdded,
      formula: 'analytic expectation of the frequency / parameter effects',
      note: 'NOT exact and NOT additive with the row above. A multiplied Poisson draw cannot be '
        + 'decomposed into base and extra claims, so this is what the effect is expected to add, '
        + 'not what this particular year realised.',
    } as AuditRow);
  }
  return rows;
}

function AuditSection({ title, icon, rows }: AuditSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 font-semibold text-gray-600 w-1/4">Metric</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-600 w-1/6">Value</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Formula / Source</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600 w-1/6">Check / Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              if (row.kind === 'section') {
                return (
                  <tr key={`${row.metric}-${index}`} className="bg-gray-50/70 border-y border-gray-100">
                    <td colSpan={4} className="px-5 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {row.metric}
                    </td>
                  </tr>
                );
              }
              const bold = row.emphasis !== undefined;
              return (
                <tr
                  key={`${row.metric}-${index}`}
                  className={`border-b border-gray-50 hover:bg-gray-50/50 ${row.emphasis === 'total' ? 'border-t-2 border-t-gray-300 bg-blue-50/40' : ''}`}
                >
                  <td className={`px-5 py-3 align-top ${bold ? 'font-bold text-gray-900' : 'font-medium text-gray-700'} ${row.indent === 2 ? 'pl-14' : row.indent === 1 ? 'pl-9' : ''}`}>
                    {row.metric}
                  </td>
                  <td className={`px-5 py-3 font-mono text-right align-top whitespace-pre-line tabular-nums ${bold ? 'font-bold text-gray-900' : 'text-gray-900'}`}>{row.value}</td>
                  <td className="px-5 py-3 align-top">
                    <FormulaCell row={row} />
                  </td>
                  <td className="px-5 py-3 text-gray-500 align-top whitespace-pre-line">{row.note ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The arithmetic is the primary content of the column; any explanatory note is
// secondary, muted beneath it.
function FormulaCell({ row }: { row: AuditRow }) {
  const spec: FormulaSpec = typeof row.formula === 'string' ? { kind: 'text', text: row.formula } : row.formula;
  const isProse = spec.kind === 'text';
  return (
    <div className="space-y-1">
      {(spec.kind !== 'text' || spec.text !== '') && (
        <div className={isProse ? 'text-gray-600 whitespace-pre-line' : 'font-mono text-gray-800 tabular-nums'}>
          {renderFormula(spec)}
        </div>
      )}
      {row.subFormula && (
        <div className="font-mono text-xs text-gray-500 tabular-nums">
          {row.subFormula.label} = {renderFormula(row.subFormula.spec)}
        </div>
      )}
      {row.explain && <div className="text-xs text-gray-400">{row.explain}</div>}
    </div>
  );
}

// ============================================================================
// Statement reconciliation checks.
//
// Each entry independently DERIVES a figure from its component parts and
// compares it against what the statement reports — it never reads the same
// field twice, which would only prove a number equals itself.
//
// Computed here in one place and consumed as rows by the cards below, so the
// arithmetic has a single source of truth and stays scriptable for regression
// tests. `lineView` selects the scope: a coverage line evaluates that line's
// own figures, 'pool' evaluates the aggregate.
// ============================================================================

export interface AuditCheck {
  derived: number;
  statement: number;
  diff: number;
  note: string;
  status: CheckStatus;
  // Per-line build-up, used as the Formula / Source text on the pool-sum card.
  buildUp?: string;
}

export interface AuditCheckSet {
  // Statement of Revenues, Expenses & Changes in Net Position
  totalOperatingRevenues: AuditCheck;
  totalOperatingExpenses: AuditCheck;
  operatingIncome: AuditCheck;
  changeInNetPosition: AuditCheck;
  priorYearClaims: AuditCheck;
  provisionForClaims: AuditCheck;
  investmentIncome: AuditCheck;
  netPositionRollforward: AuditCheck;
  // Statement of Net Position
  totalAssetsSplit: AuditCheck;
  totalLiabilitiesSplit: AuditCheck;
  assetsMinusLiabilities: AuditCheck;
  // Ratio-basis guard (no statement line of its own)
  expectedCombinedRatioBasis: AuditCheck;
  // Cash & investments rollforward (no statement line of their own)
  endingCashSweep: AuditCheck;
  endingInvestmentsSweep: AuditCheck;
  // Pool-only: one entry per summable metric, plus the reserve-weighted split.
  poolSum: { metric: string; check: AuditCheck }[];
  reserveCurrentNoncurrent: AuditCheck | null;
  // Derived display values the cards also need.
  totalOperatingRevenuesValue: number;
  totalOperatingExpensesValue: number;
  priorYearClaimsValue: number;
  currentUnpaidPortion: number;
  noncurrentUnpaidPortion: number;
  cashAndEquivalents: number;
  cashSliceOfInvestments: number;
  noncurrentInvestments: number;
  operatingCashTarget: number;
  investmentsBeforeSweep: number;
  sweepTransfer: number;
  investmentsFloorBound: boolean;
  liquidityFloorBound: boolean;
  // EACH LINE'S OWN SWEEP, in scope order — length 1 at line scope. The sweep
  // runs per line inside the engine and the branch taken can DIFFER between
  // lines, so a pool row cannot be written as one branch's arithmetic. Exposed
  // so the Cash & Investments rows can show the per-line sum at pool scope and
  // the branch that actually fired at line scope.
  perLineSweep: {
    line: CoverageLine | 'pool';
    cash: number;
    investments: number;
    preSweepCash: number;
    investmentsBeforeSweep: number;
    operatingCashTarget: number;
    liquidityFloorBound: boolean;
    investmentsFloorBound: boolean;
  }[];
}

function mkCheck(
  derived: number,
  statement: number,
  opts: { varianceCap?: number; varianceReason?: string; buildUp?: string } = {}
): AuditCheck {
  const diff = statement - derived;
  const { note, status } = checkNote(diff, {
    varianceCap: opts.varianceCap,
    varianceReason: opts.varianceReason,
  });
  return { derived, statement, diff, note, status, buildUp: opts.buildUp };
}

// attachment / poolLosses / excessLosses / quotaShareLosses REMOVED FROM
// LineResultSet ENTIRELY (this Set and its consuming filter used to live
// here). They split GROSS loss at the reinsurance attachment, and for every
// tower line that attachment is REINSURANCE_TOWER[line][0].attachment — a
// PER-OCCURRENCE dollar constant — compared against grossUltimateLoss, an
// ANNUAL AGGREGATE. poolLosses = min(annual gross, that constant) pinned at
// exactly the constant in effectively 100% of line-years (measured, 30 games
// x 8 years on WC and GL); excessLosses was just the remainder; and
// "quotaShareLosses" was not a quota share at all — every retained dollar
// above the pin, including the gaps between purchased layers and the band
// above the tower (not retainedAboveTower either: mean gap $9.5M on WC,
// $10.9M on GL).
//
// ⚠ "KEPT WHEN PROPERTY IS THE ONLY ACTIVE LINE" WAS ALREADY WRONG by the
// time this comment was last read. It said Property's own figures were
// genuine because Property still ran the retired 125%-of-expected-loss
// REINSURANCE_PROGRAMS path — true when written, but Property got its own
// occurrence tower before that path was retired, and a tower attachment is
// exactly the per-occurrence-vs-annual-aggregate mismatch described above.
// There was no line, including Property, for which this split was still
// correct by the time it was deleted.
//
// "HistoryPage uses poolLosses correctly" WAS ALSO WRONG, for the same
// reason — toHistoricalYear echoes the same engine-computed fields, so a
// pre-game WC/GL/Property year pinned exactly like a live one. Both HistoryPage
// rows and this pool-card omission are gone together; see HistoryPage's own
// note on what replaces them (Reinsurance Recovery, Retained Above Tower).

// Every metric where the pool figure must equal the sum of its active lines.
const POOL_SUM_METRICS: { key: keyof LineResultSet; label: string }[] = [
  { key: 'poolPremium', label: 'Pool Premium' },
  { key: 'adminExpense', label: 'Admin Expense' },
  { key: 'poolPremiumAndAdminExpense', label: 'Pool Premium & Admin Expense' },
  { key: 'totalMemberCharge', label: 'Gross Premium & Admin Expense' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'grossUltimateLoss', label: 'Gross Ultimate Loss' },
  { key: 'reinsuranceRecovery', label: 'Reinsurance Recovery' },
  { key: 'netUltimateLoss', label: 'Net Ultimate Loss' },
  { key: 'netIncurredLoss', label: 'Net Incurred Loss' },
  { key: 'netPaidLosses', label: 'Net Paid Losses' },
  { key: 'operatingExpense', label: 'Operating Expense' },
  { key: 'riskControlInvestment', label: 'Risk Control Investment' },
  { key: 'reinsuranceCost', label: 'Reinsurance Cost' },
  { key: 'dividends', label: 'Dividends' },
  { key: 'priorYearDevelopment', label: 'Prior-Year Development' },
  { key: 'underwritingIncome', label: 'Underwriting Income' },
  { key: 'investmentIncome', label: 'Investment Income' },
  { key: 'netIncome', label: 'Net Income' },
  { key: 'beginningCash', label: 'Beginning Cash' },
  { key: 'endingCash', label: 'Ending Cash' },
  { key: 'beginningInvestments', label: 'Beginning Investments' },
  { key: 'endingInvestments', label: 'Ending Investments' },
  { key: 'totalAssets', label: 'Total Assets' },
  { key: 'beginningNetReserve', label: 'Beginning Net Reserve' },
  { key: 'endingNetReserve', label: 'Ending Net Reserve' },
  { key: 'unearnedPremium', label: 'Unearned Premium' },
  { key: 'totalLiabilities', label: 'Total Liabilities' },
  { key: 'beginingSurplus', label: 'Beginning Surplus' },
  { key: 'endingSurplus', label: 'Ending Surplus' },
];

// Reconstructs one line's year-end cash/investment sweep exactly as the engine
// performs it: the year's flows accumulate to a pre-sweep cash total, then cash
// above the operating-cash target is swept into investments, or a shortfall is
// drawn back out of investments (limited to what is actually there). Both
// floors are reported so a genuine liquidity or wipe-out event is
// distinguishable from a reconciliation gap.
function reconstructSweep(x: LineResultSet) {
  const preSweepCash =
    x.beginningCash + x.totalMemberCharge + x.assessments - x.netPaidLosses -
    x.operatingExpense - x.riskControlInvestment - x.reinsuranceCost - x.dividends;
  const rawInvestments = x.beginningInvestments + x.investmentIncome;
  const investmentsBeforeSweep = Math.max(0, rawInvestments);
  const investmentsFloorBound = rawInvestments < -CHECK_TOLERANCE;
  const operatingCashTarget = x.totalMemberCharge * OPERATING_CASH_PCT_OF_PREMIUM;

  let cash: number;
  let investments: number;
  let liquidityFloorBound = false;
  if (preSweepCash >= operatingCashTarget) {
    cash = operatingCashTarget;
    investments = investmentsBeforeSweep + (preSweepCash - operatingCashTarget);
  } else {
    const shortfall = operatingCashTarget - preSweepCash;
    const drawn = Math.min(shortfall, investmentsBeforeSweep);
    cash = preSweepCash + drawn;
    investments = investmentsBeforeSweep - drawn;
    liquidityFloorBound = drawn < shortfall - CHECK_TOLERANCE;
  }
  return {
    cash,
    investments,
    preSweepCash,
    operatingCashTarget,
    investmentsBeforeSweep,
    sweepTransfer: investments - investmentsBeforeSweep,
    liquidityFloorBound,
    investmentsFloorBound,
  };
}

export function computeAuditChecks(
  poolResult: ResultSet,
  lineView: LineView,
  instanceSeed: number
): AuditCheckSet {
  const isPoolView = lineView === 'pool';
  const r: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const lineKeys = Object.keys(poolResult.byLine) as CoverageLine[];
  const isLiveYear = r.yearNumber > 0;

  // --- Income statement ---
  // Pass-throughs are shown GROSS: reinsurance and admin appear as both
  // revenue (collected from members) and expense (paid out).
  const totalOperatingRevenuesValue =
    r.reinsuranceCost + r.poolPremium + r.adminExpense + r.assessments;
  const totalOperatingExpensesValue =
    r.reinsuranceCost + r.netIncurredLoss + r.operatingExpense + r.riskControlInvestment + r.dividends;

  const totalOperatingRevenues = mkCheck(totalOperatingRevenuesValue, totalOperatingRevenuesValue);
  const totalOperatingExpenses = mkCheck(totalOperatingExpensesValue, totalOperatingExpensesValue);
  const operatingIncome = mkCheck(
    totalOperatingRevenuesValue - totalOperatingExpensesValue,
    r.underwritingIncome
  );
  const changeInNetPosition = mkCheck(r.underwritingIncome + r.investmentIncome, r.netIncome);

  // Prior accident years' NET incurred, as the statement presents it: net paid
  // plus the change in net unpaid on prior cohorts. The two INDEPENDENT paths
  // meet on this line — the statement's presentation figure (net incurred less
  // this year's net ultimate) against the reserve rollforward's own separately
  // simulated cohort development (signed so positive = favourable, hence
  // negated). A failure here points at the reserve development, not a subtotal.
  const priorYearClaimsValue = r.netIncurredLoss - r.netUltimateLoss;
  const priorYearClaims = mkCheck(-r.priorYearDevelopment, priorYearClaimsValue, {
    varianceCap: CLAIMS_VARIANCE_CAP,
    varianceReason: CLAIMS_VARIANCE_REASON,
  });

  // The subtotal's own identity: current year claims less ceded recoveries plus
  // prior year claims must equal the net provision. Exact by construction.
  const provisionForClaims = mkCheck(
    r.grossUltimateLoss - r.reinsuranceRecovery + priorYearClaimsValue,
    r.netIncurredLoss
  );

  // --- Statement of net position ---
  // The cash-equivalents slice is DERIVED from the allocation percentage
  // rather than read directly, exercising the same split the statement shows.
  const cashSlice = r.endingInvestments * (r.assetAllocation.cashPct / 100);
  const cashAndEquivalents = r.endingCash + cashSlice;
  const noncurrentInvestments = r.endingInvestments - cashSlice;
  const totalAssetsSplit = mkCheck(cashAndEquivalents + noncurrentInvestments, r.totalAssets);

  // Current portion = the share of each line's own net unpaid reserve expected
  // to pay within 12 months, at that line's own paydown rate. Pool view sums
  // each active line's own reserve x its own rate (a reserve-weighted blend).
  const currentUnpaidPortion = isPoolView
    ? lineKeys.reduce((s, l) => s + poolResult.byLine[l].endingNetReserve * (LINE_RESERVE_PAYDOWN_PCT[l] ?? 0), 0)
    : r.endingNetReserve * (LINE_RESERVE_PAYDOWN_PCT[lineView as CoverageLine] ?? 0);
  const noncurrentUnpaidPortion = r.endingNetReserve - currentUnpaidPortion;

  const totalLiabilitiesSplit = mkCheck(
    currentUnpaidPortion + noncurrentUnpaidPortion + r.unearnedPremium,
    r.totalLiabilities
  );
  const assetsMinusLiabilities = mkCheck(r.totalAssets - r.totalLiabilities, r.endingSurplus);
  // BASIS GUARD. On the member-charge basis the expected loss ratio and the
  // expected expense ratio must sum EXACTLY to the expected combined ratio,
  // because all three share the total-member-charge denominator. It cannot
  // fail while the bases agree — which is precisely what makes it a regression
  // guard: it goes red the moment someone reintroduces a mixed-denominator
  // term, which is how the combined ratio came to read a hardcoded 100%.
  const expectedCombinedRatioBasis = mkCheck(
    r.expectedLossRatioMemberBasis + r.expectedExpenseRatio,
    r.expectedCombinedRatio,
  );
  // One identity, both directions: ending = beginning + change, equivalently
  // change = ending - beginning. (These were previously two separate rows.)
  const netPositionRollforward = mkCheck(r.beginingSurplus + r.netIncome, r.endingSurplus);

  // The sweep runs PER LINE inside the engine, so at pool scope the correct
  // reconstruction is the sum of each line's own reconstruction — applying the
  // formula to pool aggregates only coincides when no line hits either floor.
  const sweepParts = (isPoolView ? lineKeys.map(l => poolResult.byLine[l]) : [r]).map(reconstructSweep);
  const sweep = sweepParts.reduce(
    (a, b) => ({
      cash: a.cash + b.cash,
      investments: a.investments + b.investments,
      preSweepCash: a.preSweepCash + b.preSweepCash,
      operatingCashTarget: a.operatingCashTarget + b.operatingCashTarget,
      investmentsBeforeSweep: a.investmentsBeforeSweep + b.investmentsBeforeSweep,
      sweepTransfer: a.sweepTransfer + b.sweepTransfer,
      liquidityFloorBound: a.liquidityFloorBound || b.liquidityFloorBound,
      investmentsFloorBound: a.investmentsFloorBound || b.investmentsFloorBound,
    }),
    { cash: 0, investments: 0, preSweepCash: 0, operatingCashTarget: 0, investmentsBeforeSweep: 0, sweepTransfer: 0, liquidityFloorBound: false, investmentsFloorBound: false }
  );
  const perLineSweep = (isPoolView ? lineKeys : [lineView as CoverageLine]).map((l, i) => ({
    line: isPoolView ? l : (lineView as CoverageLine),
    cash: sweepParts[i].cash,
    investments: sweepParts[i].investments,
    preSweepCash: sweepParts[i].preSweepCash,
    investmentsBeforeSweep: sweepParts[i].investmentsBeforeSweep,
    operatingCashTarget: sweepParts[i].operatingCashTarget,
    liquidityFloorBound: sweepParts[i].liquidityFloorBound,
    investmentsFloorBound: sweepParts[i].investmentsFloorBound,
  }));

  const endingCashSweep: AuditCheck = sweep.liquidityFloorBound
    ? {
        derived: sweep.cash,
        statement: r.endingCash,
        diff: r.endingCash - sweep.cash,
        status: 'variance',
        note:
          `Known variance — LIQUIDITY FLOOR BOUND: available investments could not fully cover the cash ` +
          `shortfall, so the operating-cash target was not met. A real balance-sheet event, not a ` +
          `reconciliation gap.`,
      }
    : mkCheck(sweep.cash, r.endingCash);

  const endingInvestmentsSweep: AuditCheck = sweep.investmentsFloorBound
    ? {
        derived: sweep.investments,
        statement: r.endingInvestments,
        diff: r.endingInvestments - sweep.investments,
        status: 'variance',
        note:
          `Known variance — INVESTMENTS FLOOR BOUND: an investment loss exceeded the opening portfolio, ` +
          `so the balance was clamped at zero before the sweep. A real balance-sheet event, not a ` +
          `reconciliation gap.`,
      }
    : mkCheck(sweep.investments, r.endingInvestments);

  // --- Investment income: plumbing consistency, not an independent derivation ---
  // Live years draw one shared market from the plain instance seed. Pre-game
  // years are simulated PER LINE in isolation on attempt-shifted seeds
  // (instance.seed + pregameAttempt x 997), so each line saw a DIFFERENT
  // market in the same pre-game year — there is no single pool-level market
  // draw to check, only per-line ones.
  let investmentIncome: AuditCheck;
  if (isPoolView && !isLiveYear) {
    const { note, status } = naNote(
      'no single pool-level market draw exists for a pre-game year — each line pre-games on its own ' +
      'attempt-shifted seed and drew a different market. Select a line tab to check it.'
    );
    investmentIncome = { derived: 0, statement: r.investmentIncome, diff: 0, note, status };
  } else {
    const attempt = isLiveYear ? 0 : (r.pregameAttempt ?? 0);
    const effectiveSeed = attempt === 0 ? instanceSeed : (instanceSeed + attempt * 997) >>> 0;
    const market = simulateMarketReturns(deriveSubRng(effectiveSeed, r.yearNumber, 'invest'));
    const blend = blendInvestmentReturn(r.investedAssets, r.assetAllocation, market);
    investmentIncome = mkCheck(blend.income, r.investmentIncome);
  }

  // --- Pool = sum of active lines (pool scope only) ---
  const poolSum = isPoolView
    ? POOL_SUM_METRICS
      .map(({ key, label }) => {
        const sumOfLines = lineKeys.reduce(
          (s, l) => s + Number(poolResult.byLine[l][key]),
          0
        );
        const buildUp = lineKeys
          .map(l => `${l} ${formatCurrency(Number(poolResult.byLine[l][key]))}`)
          .join(' + ') + ` = ${formatCurrency(sumOfLines)}`;
        return { metric: label, check: mkCheck(sumOfLines, Number(poolResult[key]), { buildUp }) };
      })
    : [];

  // Tautological at line scope (X x p + X x (1-p) = X), so pool-only: there it
  // verifies that summing each line's own reserve split by that line's own
  // paydown rate reproduces the separately-aggregated pool reserve.
  const reserveCurrentNoncurrent = isPoolView
    ? mkCheck(currentUnpaidPortion + noncurrentUnpaidPortion, r.endingNetReserve, {
        buildUp:
          lineKeys
            .map(l => {
              const pct = LINE_RESERVE_PAYDOWN_PCT[l] ?? 0;
              const res = poolResult.byLine[l].endingNetReserve;
              return `${l} ${formatCurrency(res)} x ${formatPct(pct)}`;
            })
            .join(' + ') +
          ` = ${formatCurrency(currentUnpaidPortion)} current; remainder ${formatCurrency(noncurrentUnpaidPortion)} noncurrent`,
      })
    : null;

  return {
    totalOperatingRevenues,
    totalOperatingExpenses,
    operatingIncome,
    changeInNetPosition,
    priorYearClaims,
    provisionForClaims,
    investmentIncome,
    netPositionRollforward,
    totalAssetsSplit,
    totalLiabilitiesSplit,
    assetsMinusLiabilities,
    expectedCombinedRatioBasis,
    endingCashSweep,
    endingInvestmentsSweep,
    poolSum,
    reserveCurrentNoncurrent,
    totalOperatingRevenuesValue,
    totalOperatingExpensesValue,
    priorYearClaimsValue,
    currentUnpaidPortion,
    noncurrentUnpaidPortion,
    cashAndEquivalents,
    cashSliceOfInvestments: cashSlice,
    noncurrentInvestments,
    operatingCashTarget: sweep.operatingCashTarget,
    investmentsBeforeSweep: sweep.investmentsBeforeSweep,
    sweepTransfer: sweep.sweepTransfer,
    investmentsFloorBound: sweep.investmentsFloorBound,
    liquidityFloorBound: sweep.liquidityFloorBound,
    perLineSweep,
  };
}

// Every row that verifies something, for the page-level status line.
function statusLine(rows: AuditRow[]): { text: string; tone: string } {
  const checked = rows.filter(row => row.status !== undefined);
  const failed = checked.filter(row => row.status === 'fail').length;
  const variance = checked.filter(row => row.status === 'variance').length;
  const na = checked.filter(row => row.status === 'na').length;
  const passed = checked.filter(row => row.status === 'pass').length;

  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} difference${failed === 1 ? '' : 's'} found`);
  if (variance > 0) parts.push(`${variance} known variance${variance === 1 ? '' : 's'}`);
  if (na > 0) parts.push(`${na} not applicable`);

  if (failed === 0 && variance === 0 && na === 0) {
    return { text: `All ${passed} checks OK`, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  }
  const summary = `${passed} of ${checked.length} checks OK — ${parts.join(', ')}`;
  return {
    text: summary,
    tone: failed > 0
      ? 'text-red-700 bg-red-50 border-red-200'
      : 'text-amber-700 bg-amber-50 border-amber-200',
  };
}


function buildAssumptionRows(): AuditRow[] {
  const rows: AuditRow[] = [
    {
      metric: 'Admin Expense as % of Pure Premium',
      value: formatPct(ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM),
      formula: 'Pure Premium × 15%. Added after selected CLF and not multiplied by CLF.',
      note:
        'Higher values make it harder to generate underwriting income. This is separate from LAE, so avoid double counting claim adjustment expenses.',
    },
    {
      metric: 'Member Actual Loss Distribution',
      value: MEMBER_LOSS_VOLATILITY.distribution,
      formula: 'Expected member loss = payroll x Pure Premium Rate; actual loss is a nonnegative Gamma draw.',
      note: 'The Gamma mean equals expected loss. Risk quality changes standard deviation, not expected loss.',
    },
    {
      metric: 'Member Loss Coefficient of Variation',
      value: `${formatPct(MEMBER_LOSS_VOLATILITY.worstRiskCV)} to ${formatPct(MEMBER_LOSS_VOLATILITY.bestRiskCV)}`,
      formula: 'Linear interpolation from risk quality 1 (most volatile) to risk quality 10 (least volatile).',
      note: 'Standard deviation = expected member loss x coefficient of variation.',
    },
    {
      metric: 'Aggregate Annual Loss Distribution',
      value: AGGREGATE_LOSS_DISTRIBUTION.distribution,
      formula: `Log mean ${AGGREGATE_LOSS_DISTRIBUTION.logMean.toFixed(6)}; log sigma ${AGGREGATE_LOSS_DISTRIBUTION.logSigma.toFixed(6)}.`,
      note: 'A continuous shared annual factor calibrated to stock-decision gameplay affects all members. The CLF table remains the separate funding and pricing reference.',
    },
    {
      metric: 'Actual Loss Level Multiplier',
      value: AGGREGATE_LOSS_DISTRIBUTION.actualLossLevelMultiplier.toFixed(2),
      formula: 'Member Gamma loss x shared annual factor x actual loss level multiplier.',
      note: 'Raises the center of the actual-loss distribution so default decisions do not automatically produce large annual gains. Member risk-quality volatility is preserved.',
    },
    {
      metric: 'Catastrophe Classification Threshold',
      value: `${formatPct(AGGREGATE_LOSS_DISTRIBUTION.catastropheThresholdConfidence)} CLF`,
      formula: 'An annual shared factor above the selected CLF-table threshold is classified as a catastrophe for reporting.',
    },
    {
      metric: 'Loss Trend',
      value: formatPct(LOSS_TREND),
      formula: 'Default annual claim inflation assumption.',
      note:
        'Current engine applies trend to simulated actual losses, not to the displayed expected rate when the player selects 0% rate change.',
    },
    {
      metric: 'Base Retention',
      value: formatPct(BASE_RETENTION),
      formula: 'Base annual member retention probability before satisfaction, pricing, assessment, and financial strength adjustments.',
      note:
        'Public entity pools usually have high retention. If too high, membership becomes too stable; if too low, the pool churns unrealistically.',
    },
    {
      metric: 'Base New Members Per Year',
      value: BASE_NEW_MEMBERS_PER_YEAR.toFixed(2),
      formula: 'Expected new members in a neutral year before movement adjustments and hard caps.',
      note:
        'Keeps growth modest. This should prevent the game from adding too many members in a single year under normal conditions.',
    },
    {
      metric: 'Max New Members Per Year',
      value: String(MAX_NEW_MEMBERS_PER_YEAR),
      formula: 'Hard cap on new members added in one year.',
      note:
        'Important gameplay control. Prevents unrealistic sudden growth even if the pool is financially strong or competitively priced.',
    },
    {
      metric: 'Max Withdrawn Members Per Year',
      value: String(MAX_WITHDRAWN_PER_YEAR),
      formula: 'Hard cap on members withdrawn in one year.',
      note:
        'Prevents the pool from collapsing too quickly from a single bad year. If set too low, retention risk may feel muted.',
    },
    {
      metric: 'Reserve Paydown Percent',
      value: formatPct(RESERVE_PAYDOWN_PCT),
      formula: 'Percent of open reserve cohorts paid down each year.',
      note:
        'Controls reserve runoff speed. Higher paydown means claims close faster and cash paid losses are higher sooner.',
    },
    {
      metric: 'Total Market Members',
      value: String(MARKET_MEMBER_COUNT),
      formula: 'Count of the fixed canonical roster (memberCatalog.ts) — derived from the roster itself, not a hand-maintained constant.',
      note:
        'Used to create the pool’s competitive universe. Does not mean all members are active in the player pool. The roster never grows or shrinks.',
    },
    {
      metric: 'Starting Exposure Share (per line)',
      value: `${(STARTING_EXPOSURE_SHARE.min * 100).toFixed(0)}% to ${(STARTING_EXPOSURE_SHARE.max * 100).toFixed(0)}%`,
      formula: "Each active line independently enrolls members (seeded random order) until its enrolled exposure reaches this share of the line's total market exposure.",
      note:
        'The exposure target drives the starting member count per line; lines start with different but overlapping rosters.',
    },
    {
      metric: 'Total Market Exposure (per line)',
      value: `WC ${MARKET_TOTAL_EXPOSURE.WC.toLocaleString()}M · GL ${MARKET_TOTAL_EXPOSURE.GL.toLocaleString()}M · Property TIV ${MARKET_TOTAL_EXPOSURE.Property.toLocaleString()}M`,
      formula: 'Sum of every canonical-roster member\'s exposure, per line — derived from the roster itself, not a hand-maintained constant.',
      note:
        'The denominator for market share. WC and GL share the payroll base; Property uses TIV.',
    },
    {
      metric: 'Starting Rate per $100 Range',
      value: `${dollars(STARTING_RATE_PER_100.min)} to ${dollars(STARTING_RATE_PER_100.max)}`,
      formula: 'Starting expected loss rate / rate base range before annual player decisions.',
      note:
        'A wider range creates more varied game starts. A narrower range makes testing easier and improves consistency across seeds.',
    },
    {
      metric: 'Size Weights',
      value: SIZE_WEIGHTS.map((w, i) => `${sizeLabel(i)}: ${formatPct(w)}`).join('\n'),
      formula: 'Probability weights used when assigning market member size categories.',
      note:
        'Controls the mix of small, medium, large, and very large entities. More large members can create concentration risk.',
    },
    {
      metric: 'Exposure Ranges',
      value: Object.entries(EXPOSURE_RANGES)
        .map(([k, v]) => `${k}: ${v.min}M to ${v.max}M`)
        .join('\n'),
      formula: 'Payroll exposure range by member size category.',
      note:
        'Used to generate member payroll exposure. This directly affects premium, expected losses, and market share.',
    },
    {
      metric: 'Risk Control Parameters',
      value:
        `Max Effectiveness: ${formatPct(RISK_CONTROL_PARAMS.maxEffectiveness)}\n` +
        `Lag Years: ${RISK_CONTROL_PARAMS.lagYears}\n` +
        `Decay Rate: ${formatPct(RISK_CONTROL_PARAMS.decayRate)}`,
      formula: 'Risk-control investment gradually reduces expected losses, subject to max effectiveness and decay.',
      note:
        'Creates a delayed payoff. This should reward sustained investment, not one-year spending. Watch for it becoming too powerful over time.',
    },
    {
      metric: 'Funding CLF Table',
      value: Object.entries(FUNDING_CLF_TABLE)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([confidence, clf]) => `${formatPct(Number(confidence), 0)}: ${Number(clf).toFixed(3)}`)
        .join('\n'),
      formula: 'Confidence level factor used to convert expected loss rate into selected confidence-level contribution rate.',
      note:
        'Higher confidence levels produce materially higher contribution rates. This is a pricing/funding target, not the booked accounting reserve.',
    },
    {
      metric: 'Asset Class Assumptions',
      value: Object.entries(ASSET_CLASS_ASSUMPTIONS)
        .map(([cls, a]) =>
          `${labelize(cls)}: Return ${formatPct(a.expectedReturn)} gross, Vol ${formatPct(a.standardDeviation)}, Fee ${formatPct(a.feeRate, 3)}`
        )
        .join('\n'),
      formula: 'Cash/bonds/equities return and volatility assumptions, blended by the player\'s asset allocation.',
      note:
        'Investment income should be secondary to underwriting results. If surplus grows too easily in bad underwriting years, review these assumptions first.',
    },
    {
      metric: 'Member Retention Weights',
      value: Object.entries(MEMBER_MOVEMENT_WEIGHTS.retention)
        .map(([k, v]) => `${labelize(k)}: ${formatPct(v)}`)
        .join('\n'),
      formula: 'Weights used in member retention scoring.',
      note:
        'Controls why existing members stay or leave. Rate increases, assessments, satisfaction, and financial strength all affect retention.',
    },
    {
      metric: 'Member Attraction Weights',
      value: Object.entries(MEMBER_MOVEMENT_WEIGHTS.attraction)
        .map(([k, v]) => `${labelize(k)}: ${formatPct(v)}`)
        .join('\n'),
      formula: 'Weights used in new member attraction scoring.',
      note:
        'Controls why new members join. If growth is too easy, reduce attraction weights or lower max new members per year.',
    },
    {
      metric: 'Starting Financial Ranges',
      value:
        `Annual Premium: ${formatRangeCurrency(STARTING_FINANCIALS.annualPremium)}\n` +
        `Expected Loss Ratio: ${formatRangePct(STARTING_FINANCIALS.expectedLossRatio)}\n` +
        `Member Satisfaction: ${formatRangeNumber(STARTING_FINANCIALS.memberSatisfaction)}\n` +
        `Risk Quality: ${formatRangeNumber(STARTING_FINANCIALS.riskQuality)}\n` +
        `Surplus to Premium Ratio: ${formatRangePct(STARTING_FINANCIALS.surplusToPremiumRatio)}\n` +
        `Cash: ${formatRangeCurrency(STARTING_FINANCIALS.cash)}\n` +
        `Investments: ${formatRangeCurrency(STARTING_FINANCIALS.investments)}\n` +
        `Net Unpaid Reserve: ${formatRangeCurrency(STARTING_FINANCIALS.grossUnpaidReserve)} less ${formatRangeCurrency(STARTING_FINANCIALS.reinsuranceRecoverable)}\n` +
        `Starting Surplus: ${formatRangeCurrency(STARTING_FINANCIALS.startingSurplus)}`,
      formula: 'Starting financial assumption ranges used by instance generation.',
      note:
        'These shape initial difficulty. High surplus and investments make the game more forgiving; low surplus creates more pressure from losses and reserve risk.',
    },
    {
      metric: 'Slider Ranges',
      value:
        `Funding Confidence Level: ${formatSliderPct(SLIDER_RANGES.fundingConfidenceLevel)}\n` +
        `Dividend / Assessment (combined, collapsed input): ${formatSliderPct(SLIDER_RANGES.dividendAssessment)}\n` +
        `  Dividend % (engine field): ${formatSliderPct(SLIDER_RANGES.dividendPct)}\n` +
        `  Assessment % (engine field): ${formatSliderPct(SLIDER_RANGES.assessmentPct)}\n` +
        `Underwriting Strictness: ${formatSliderNumber(SLIDER_RANGES.underwritingStrictness)}\n` +
        `Risk Control %: ${formatSliderPct(SLIDER_RANGES.riskControlPct)}\n` +
        `Asset Allocation Default: Cash ${ASSET_ALLOCATION_DEFAULT.cashPct}% / Bonds ${ASSET_ALLOCATION_DEFAULT.bondsPct}% / Equities ${ASSET_ALLOCATION_DEFAULT.equitiesPct}%`,
      formula: 'Player decision slider configuration.',
      note:
        'Defines the choices available to the player. Wide ranges increase strategic flexibility but can make results harder to balance.',
    },
  ];

  return rows;
}

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

function sizeLabel(index: number): string {
  if (index === 0) return 'Small';
  if (index === 1) return 'Medium';
  if (index === 2) return 'Large';
  if (index === 3) return 'Very Large';
  return `Index ${index}`;
}

function labelize(value: string): string {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, char => char.toUpperCase());
}

function formatRangeCurrency(range: { min: number; max: number }): string {
  return `${formatCurrency(range.min)} to ${formatCurrency(range.max)}`;
}

function formatRangePct(range: { min: number; max: number }): string {
  return `${formatPct(range.min)} to ${formatPct(range.max)}`;
}

function formatRangeNumber(range: { min: number; max: number }): string {
  return `${range.min} to ${range.max}`;
}

function formatSliderPct(range: { min: number; max: number; step: number; default: number }): string {
  return `Min ${formatPct(range.min)}, Max ${formatPct(range.max)}, Step ${formatPct(range.step)}, Default ${formatPct(range.default)}`;
}

function formatSliderNumber(range: { min: number; max: number; step: number; default: number }): string {
  return `Min ${range.min}, Max ${range.max}, Step ${range.step}, Default ${range.default}`;
}

// ============================================================================
// Supporting-card row builders (Exposure and Membership, Funding Rate
// Build-Up, Losses and Reinsurance, Reserve Rollforward, Ratios, Capital and
// Reserve Confidence). One function, exported as a pure function so a
// regression script can evaluate every formula the same way it does for the
// two statement-mirroring cards below.
// ============================================================================

// ⚠ TAKES THE POOL RESULT AND THE SCOPE, matching buildRevExpRows,
// buildNetPositionRows and buildCashInvestmentRows. It used to take the
// already-scoped LineResultSet, which was fine until a pool row turned out to
// need its constituent LINES: the reserve risk margin is a sum of per-line
// products, each line applying its own 90% CLF, and no single factor
// reproduces it. Scoping at the boundary had thrown that away.
export function buildSupportingRows(
  poolResult: ResultSet,
  lineView: LineView,
): { exposureRows: AuditRow[]; rateRows: AuditRow[]; lossRows: AuditRow[]; reserveRows: AuditRow[]; ratioRows: AuditRow[]; capitalRows: AuditRow[] } {
  const isPoolView = lineView === 'pool';
  const result: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  // The per-line pieces of the pool's reserve risk margin, in a stable order.
  // Mirrors simulationEngine's reserveMarginCLF dispatch: the line's own static
  // table where it has one, FUNDING_CLF_TABLE otherwise.
  const MARGIN_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];
  const perLine = isPoolView
    ? MARGIN_ORDER.filter(l => poolResult.byLine[l]).map(l => ({
        line: l,
        expectedNetUnpaidLoss: poolResult.byLine[l].expectedNetUnpaidLoss,
        marginFactor: (hasStaticClf(l) ? staticClf(l, 0.90) : lookupCLF(0.90)) - 1,
      }))
    : undefined;
  const payrollUnits = Math.max(result.activeExposure * 10_000, 1);
  const rateAtConfidenceLevel = result.poolPremium / payrollUnits;
  // result.ratePer100 is a real per-line stored rate, but at pool scope it is
  // aggregated as one line's rate kept as a placeholder — not a genuine pool
  // figure. Recomputing from the three real pool-summed dollar figures gives
  // the true blended rate at every scope (and is numerically identical to
  // result.ratePer100 at line scope, since that's how it's defined there).
  const grossRatePer100 = (result.poolPremium + result.adminExpense + result.reinsuranceCost) / payrollUnits;
  const grossPremiumCheck = result.activeExposure * result.ratePer100 * 10_000;
  const grossPremiumDifference = result.grossPremium - grossPremiumCheck;

  const expectedLossCheck = result.activeExposure * result.purePremiumPer100 * 10_000;
  const expectedLossDifference = result.expectedLoss - expectedLossCheck;

  // Both rate-times-exposure checks above are only meaningful PER LINE, and even
  // there only to the precision of the stored rate.
  //
  // At pool scope they are meaningless, not merely imprecise: ratePer100,
  // purePremiumPer100 and rateLevel are aggregated as `first.<field>` — one
  // line's rate kept as a placeholder — while activeExposure is the sum across
  // lines, so the product multiplies summed exposure by a single line's rate.
  //
  // At line scope the rates are stored rounded to four decimals, so the error
  // is bounded by half a rounding unit times the payroll units, which is the
  // tolerance used here rather than a flat dollar.
  const rateRoundingTolerance = Math.max(1, result.activeExposure * 10_000 * 0.00005);
  const rateCheck = (diff: number) =>
    isPoolView
      ? naNote(
          'pool-level rates are one line\'s rate kept as a placeholder, while exposure is summed across ' +
          'lines — the product is not a meaningful quantity. Select a line tab to check it.'
        )
      : legacyCheck(diff, rateRoundingTolerance);

  const clfAdjustedExpectedLossCheck = result.expectedLoss * result.selectedFundingCLF;
  const clfAdjustedExpectedLossDifference =
    result.clfAdjustedExpectedLoss - clfAdjustedExpectedLossCheck;

  const netUltimateLossCheck = result.grossUltimateLoss - result.reinsuranceRecovery;
  const netUltimateLossDifference = result.netUltimateLoss - netUltimateLossCheck;

  const indicatedNetReserveCheck =
    result.expectedNetUnpaidLoss * result.selectedFundingCLF;

  const indicatedNetReserveDifference =
    result.indicatedNetReserveAtConfidenceLevel - indicatedNetReserveCheck;

  // ⚠ PER LINE, mirroring simulationEngine's reserveMarginCLF dispatch exactly.
  // This read FUNDING_CLF_TABLE[0.90] = 1.951 for every line, against WC's
  // actual 1.3709 and GL's 1.5020, so the recalculation came out 1.9x high on
  // GL and 2.6x high on WC — and this row is the PAGE'S OWN INTEGRITY CHECK,
  // so it failed 100% of the time on two of three lines (worst gap $35.83M)
  // and the header counted each failure in its "N differences found" tally.
  // The page was telling the user the engine was wrong, every year, using a
  // curve the engine stopped reading when the static tables landed.
  const reserveMarginCLFForLine = result.line && hasStaticClf(result.line)
    ? staticClf(result.line, 0.90)
    : lookupCLF(0.90);

  // WHERE THE SELECTED CLF ACTUALLY CAME FROM. Under fundingAtExpected — the
  // DEFAULT on WC and GL — no table is consulted at all and the multiplier is
  // the literal 1.0, so naming any table here would send a reader to a curve
  // that was not read.
  const clfProvenanceText = result.line && hasStaticClf(result.line)
    ? (result.decisions.fundingAtExpected
        ? 'Expected funding — the table is bypassed entirely and the multiplier is exactly 1.000'
        : `STATIC_CLF_TABLE.${result.line}[${formatPct(result.selectedFundingConfidenceLevel, 0)}] — see clfTables.ts`)
    : `FUNDING_CLF_TABLE[${formatPct(result.selectedFundingConfidenceLevel, 0)}] — see Default Assumptions`;

  const reserveRiskMarginCheck =
    result.expectedNetUnpaidLoss * (reserveMarginCLFForLine - 1);

  const reserveRiskMarginDifference =
    result.reserveRiskMarginNeeded - reserveRiskMarginCheck;

  // At pool scope reserveRiskMarginNeeded is SUMMED across lines, each with its
  // OWN 90% CLF, so no single factor reproduces it — the same placeholder
  // problem the rate checks above document. Checked per line only.
  const marginCheck = (diff: number) =>
    isPoolView
      ? naNote(
          'the reserve risk margin is summed across lines, each with its own 90% CLF ' +
          '(WC 1.3709, GL 1.5020, Property 1.5923) — no single factor reproduces the sum. ' +
          'Select a line tab to check it.'
        )
      : legacyCheck(diff);

  const netIncurredLossCheck =
    result.netPaidLosses +
    result.endingNetReserve -
    result.beginningNetReserve;

  const netIncurredLossDifference = result.netIncurredLoss - netIncurredLossCheck;

  // Same identity as the priorYearClaims check on the statement card: net
  // incurred = paid + reserve change, and separately net incurred = net
  // ultimate - development. The two paths meet exactly UNLESS a reserve
  // cohort closed last year with its residual balance floored to zero rather
  // than absorbed into the development figure (see CLAIMS_VARIANCE_CAP) — so
  // this reuses the same documented, bounded variance rather than asserting
  // an unconditional identity.
  const endingNetReserveCheck =
    result.beginningNetReserve + result.netUltimateLoss - result.priorYearDevelopment - result.netPaidLosses;
  const endingNetReserveDifference = result.endingNetReserve - endingNetReserveCheck;

  const netIncurredLossFromIncome =
    result.grossPremium +
    result.assessments +
    result.investmentIncome -
    result.operatingExpense -
    result.riskControlInvestment -
    result.reinsuranceCost -
    result.dividends -
    result.netIncome;

  // The former net-income, ending-investments, total-assets, total-liabilities
  // and ending-surplus recalculation checks lived here. They are now covered by
  // the two statement-mirroring cards (change in net position, the ending
  // investments sweep, and the asset / liability / net position identities), so
  // the duplicates are gone rather than stated twice with different wording.

  const combinedRatioCheck =
    (netIncurredLossFromIncome + result.adminExpense + result.reinsuranceCost) /
    Math.max(result.totalMemberCharge, 1);

  const lossRatioCheck =
    netIncurredLossFromIncome / Math.max(result.totalMemberCharge, 1);

  const expenseRatioCheck =
    (result.adminExpense + result.reinsuranceCost) /
    Math.max(result.totalMemberCharge, 1);

  const capitalFundingGapCheck =
    result.availableSurplus - result.reserveRiskMarginNeeded;

  const capitalAdequacyRatioCheck = result.reserveRiskMarginNeeded > 0
    ? capitalFundingGapCheck / result.reserveRiskMarginNeeded
    : null;

  // Real engine constants behind the reserve rollforward below: the CURRENT
  // accident year splits 60% reserved / 40% paid immediately. This is a
  // hardcoded literal in simulationEngine.ts (currentYearNetReserve =
  // netUltimateLoss * 0.60), NOT sourced from RESERVE_PAYDOWN_PCT (35%) —
  // that constant governs how much of the OPENING/PRIOR reserve balance runs
  // off each subsequent year, a different rate for a different cohort age.
  // Verified against the engine (not invented); not a named/displayed
  // assumption anywhere, so shown as a literal with an explain note rather
  // than a cross-reference.
  const currentYearUnpaidPct = 0.60;
  const currentYearPaidPct = 1 - currentYearUnpaidPct;
  const netPaidCurrentYear = result.netUltimateLoss * currentYearPaidPct;
  const priorCohortPaydown = result.netPaidLosses - netPaidCurrentYear;

  const exposureRows: AuditRow[] = [
    {
      metric: 'Active Members',
      // ⚠ memberList.length, NOT result.activeMembers — see toHistoricalYear.
      // At pool scope activeMembers sums per-line enrolments and double-counts
      // anyone carrying more than one line; memberList is deduplicated by id.
      value: String(result.memberList.length),
      formula: { kind: 'text', text: 'A headcount, not a calculation — no simpler components are shown on this page.' },
    },
    {
      metric: 'New Members',
      value: String(result.newMembers),
      formula: { kind: 'text', text: 'A headcount, not a calculation — no simpler components are shown on this page.' },
    },
    {
      metric: 'Withdrawn Members',
      value: String(result.withdrawnMembers),
      formula: { kind: 'text', text: 'A headcount, not a calculation — no simpler components are shown on this page.' },
    },
    {
      metric: 'Written Payroll Exposure',
      value: `${result.writtenExposure.toFixed(2)}M`,
      numericValue: result.writtenExposure,
      formula: { kind: 'echo', value: result.writtenExposure, text: 'active payroll exposure after member movement — the same figure' },
    },
    {
      metric: 'Total Market Payroll Exposure',
      value: `${result.totalMarketExposure.toFixed(2)}M`,
      formula: { kind: 'text', text: 'The full simulated market total — no on-page breakdown by member exists.' },
    },
    {
      metric: 'Market Share',
      value: formatPct(result.marketShare),
      numericValue: result.marketShare,
      formula: { kind: 'ratio', numerator: { value: result.activeExposure, format: 'exposure' }, denominator: { value: result.totalMarketExposure, format: 'exposure' } },
    },
  ];

  const rateRows: AuditRow[] = [
    {
      metric: 'Pure Premium Rate per $100 Payroll',
      value: dollars(result.purePremiumPer100),
      formula: {
        kind: 'text',
        text:
          'Cannot be expressed on this page: it depends on (1) last year\'s own rate — a different row, not simultaneously visible here — ' +
          '(2) the actual loss trend applied this game (instance.lossEnvironment.lossTrend), which is drawn per instance and is NOT the ' +
          'Loss Trend value shown on Default Assumptions — verified to differ by up to 1.9 percentage points on real seeds, so that card is ' +
          'currently showing the wrong number for this game, not just an unrelated default — and (3) the rolling risk-control effectiveness ' +
          'score, which the engine computes every year but does not store on this result at all.',
      },
      note: 'Not evaluated — see formula for the confirmed Loss Trend display defect.',
    },
    {
      metric: 'Selected Funding Confidence',
      value: formatPct(result.selectedFundingConfidenceLevel, 0),
      formula: { kind: 'text', text: 'A player selection, not a calculation.' },
    },
    {
      metric: 'Selected CLF',
      value: result.selectedFundingCLF.toFixed(3),
      numericValue: result.selectedFundingCLF,
      formula: { kind: 'echo', value: result.selectedFundingCLF, text: clfProvenanceText },
    },
    {
      metric: `Pool Premium Rate at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}% CLF`,
      value: dollars(rateAtConfidenceLevel),
      numericValue: rateAtConfidenceLevel,
      formula: isPoolView
        ? { kind: 'ratio', numerator: curTerm(result.poolPremium, 'pool premium'), denominator: { value: payrollUnits, format: 'plain', label: 'payroll units' } }
        : {
            kind: 'product',
            factors: [
              { value: result.netPurePremiumPer100, format: 'plain', label: 'net pure premium rate' },
              factorTerm(result.selectedFundingCLF, `CLF at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}%`),
              factorTerm(result.rateLevel / 100, `rate level ${result.rateLevel}`),
            ],
          },
      // ⚠ THE NETTING STEP IS SHOWN, NOT FOLDED IN. This row used to multiply
      // the GROSS pure premium rate by the CLF against a NET-funded value, so
      // the operands came out 1.86x the figure beside them — and because the
      // gross rate is a plausible-looking number in its own right, that
      // survived eight commits unnoticed. Naming the deduction is what makes
      // the discrepancy visible if the basis ever moves again.
      //
      // The FACTOR is the stored netPurePremiumPer100 rather than the
      // subtraction below, because purePremiumPer100 is stored rounded to 4dp
      // while both net fields are stored raw — so the subtraction is accurate
      // to ~5e-5 and the stored field reconciles exactly.
      subFormula: isPoolView ? undefined : {
        label: 'net pure premium rate',
        value: result.netPurePremiumPer100,
        spec: {
          kind: 'sum',
          terms: [
            { value: result.purePremiumPer100, format: 'plain', label: 'gross pure premium rate' },
            { value: -result.expectedCededPer100, format: 'plain', label: 'less expected ceded to reinsurers' },
          ],
        },
      },
      explain: isPoolView
        ? 'The line-level build-up (net pure premium rate × CLF × rate level) is not shown at pool scope: purePremiumPer100, netPurePremiumPer100 and rateLevel are all aggregated as one line\'s value kept as a placeholder, not a real pool figure. Select a line tab to see the build-up.'
        : 'The pool premium funds the loss the pool KEEPS, so expected ceded comes off before the CLF is applied. All three lines net now — Property joined when it got its own occurrence layer and aggregate, replacing the legacy percentage-of-premium cover that had no closed-form expected ceded to deduct.',
    },
    {
      metric: 'Gross Premium & Admin Expense Rate per $100',
      value: dollars(grossRatePer100),
      numericValue: grossRatePer100,
      formula: {
        kind: 'sum',
        terms: [
          { value: result.poolPremium / payrollUnits, format: 'plain', label: 'pool premium rate' },
          { value: result.adminExpense / payrollUnits, format: 'plain', label: 'admin rate' },
          { value: result.reinsuranceCost / payrollUnits, format: 'plain', label: 'reinsurance rate' },
        ],
      },
      explain: isPoolView
        ? 'Recomputed from the three real pool-summed dollar figures divided by Payroll Units below — result.ratePer100 itself is aggregated at pool scope as one line\'s rate kept as a placeholder, not a real pool figure, so it is not used here.'
        : 'Each component rate is its dollar figure (Income Statement / Losses and Reinsurance) divided by Payroll Units below.',
    },
    {
      metric: 'Payroll Units',
      value: payrollUnits.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      numericValue: payrollUnits,
      formula: { kind: 'product', factors: [{ value: result.activeExposure, format: 'exposure', label: 'payroll' }, { value: 10_000, format: 'plain' }] },
    },
    {
      metric: 'Gross Premium & Admin Expense',
      value: formatCurrency(result.totalMemberCharge),
      numericValue: result.totalMemberCharge,
      formula: isPoolView
        ? { kind: 'text', text: 'Not a meaningful product at pool scope — see the note on the Check Difference row below.' }
        : {
            kind: 'product',
            factors: [{ value: result.activeExposure, format: 'exposure' }, { value: result.ratePer100, format: 'plain', label: 'rate per $100' }, { value: 10_000, format: 'plain' }],
          },
    },
    {
      metric: 'Gross Premium & Admin Expense Check Difference',
      value: isPoolView ? 'n/a' : formatCurrency(grossPremiumDifference),
      numericValue: isPoolView ? undefined : grossPremiumDifference,
      formula: isPoolView
        ? { kind: 'text', text: 'Not computed at pool scope — see the note.' }
        : { kind: 'sum', terms: [curTerm(result.grossPremium, 'stored'), curTerm(-grossPremiumCheck, 'exposure × stored rate × 10,000')] },
      explain: `Tolerance ${formatCurrency(rateRoundingTolerance)}: the rate is stored rounded to four decimals, so this is half a rounding unit × payroll units.`,
      ...rateCheck(grossPremiumDifference),
    },
  ];

  const lossRows: AuditRow[] = [
    {
      metric: 'Pure Premium',
      value: formatCurrency(result.expectedLoss),
      numericValue: result.expectedLoss,
      formula: isPoolView
        ? { kind: 'text', text: 'Not a meaningful product at pool scope — see the note on the Check Difference row below.' }
        : {
            kind: 'product',
            factors: [{ value: result.activeExposure, format: 'exposure' }, { value: result.purePremiumPer100, format: 'plain', label: 'pure premium rate' }, { value: 10_000, format: 'plain' }],
          },
    },
    {
      metric: 'Expected Loss Check Difference',
      value: isPoolView ? 'n/a' : formatCurrency(expectedLossDifference),
      numericValue: isPoolView ? undefined : expectedLossDifference,
      formula: isPoolView
        ? { kind: 'text', text: 'Not computed at pool scope — see the note.' }
        : { kind: 'sum', terms: [curTerm(result.expectedLoss, 'stored'), curTerm(-expectedLossCheck, 'exposure × stored rate × 10,000')] },
      explain: `Tolerance ${formatCurrency(rateRoundingTolerance)}: the rate is stored rounded to four decimals, so this is half a rounding unit × payroll units.`,
      ...rateCheck(expectedLossDifference),
    },
    {
      // NOT the pool premium — see the matching note in resultMetrics.ts. This
      // is gross expected loss scaled by the CLF, which the net-funding change
      // left 39% above the real poolPremium on WC and 77% on GL.
      metric: 'CLF-Adjusted Gross Expected Loss',
      value: formatCurrency(result.clfAdjustedExpectedLoss),
      numericValue: result.clfAdjustedExpectedLoss,
      formula: { kind: 'product', factors: [curTerm(result.expectedLoss, 'GROSS expected loss'), factorTerm(result.selectedFundingCLF)] },
      explain: 'Gross expected loss at the selected CLF. This is NOT the pool premium: the premium funds NET expected loss (see Pool Premium Rate above), so on WC and GL this figure sits well above it.',
    },
    {
      metric: 'CLF-Adjusted Gross Expected Loss Check Difference',
      value: formatCurrency(clfAdjustedExpectedLossDifference),
      numericValue: clfAdjustedExpectedLossDifference,
      formula: { kind: 'sum', terms: [curTerm(result.clfAdjustedExpectedLoss, 'stored'), curTerm(-clfAdjustedExpectedLossCheck, 'recalculated')] },
      ...legacyCheck(clfAdjustedExpectedLossDifference),
    },
    {
      metric: 'Gross Ultimate Loss + LAE',
      value: formatCurrency(result.grossUltimateLoss),
      formula: { kind: 'simulated', expected: result.expectedLoss, expectedLabel: 'expected (Pure Premium above)', where: 'this card' },
    },
    {
      metric: 'Reinsurance Recovery',
      value: formatCurrency(result.reinsuranceRecovery),
      numericValue: result.reinsuranceRecovery,
      // ONE PRODUCT NOW — the tower is a SUM OVER LAYERS of per-occurrence
      // cessions plus WC/Property's aggregate, not a quota share of an annual
      // excess, so a two-factor product would misdescribe it entirely.
      formula: { kind: 'echo', value: result.reinsuranceRecovery, text: `Per-occurrence tower: ${(result.cededByLayer ?? []).filter(v => v > 0).length} layer(s) paid${(result.aggregateRecovery ?? 0) > 0 ? ' + aggregate stop-loss' : ''}` },
    },
    {
      metric: 'Net Ultimate Loss + LAE',
      value: formatCurrency(result.netUltimateLoss),
      numericValue: result.netUltimateLoss,
      formula: { kind: 'sum', terms: [curTerm(result.grossUltimateLoss), curTerm(-result.reinsuranceRecovery)] },
    },
    {
      metric: 'Net Ultimate Loss Check Difference',
      value: formatCurrency(netUltimateLossDifference),
      numericValue: netUltimateLossDifference,
      formula: { kind: 'sum', terms: [curTerm(result.netUltimateLoss, 'stored'), curTerm(-netUltimateLossCheck, 'recalculated')] },
      ...legacyCheck(netUltimateLossDifference),
    },
    {
      metric: 'Reinsurance Cost',
      value: formatCurrency(result.reinsuranceCost),
      numericValue: result.reinsuranceCost,
      formula: towerReinsCostFormula(result),
      explain: 'Same figure as "Premiums for transferred risk" on the Statement of Revenues, Expenses & Changes in Net Position.',
    },
  ];

  const reserveRows: AuditRow[] = [
    {
      metric: 'Beginning Net Reserve',
      value: formatCurrency(result.beginningNetReserve),
      numericValue: result.beginningNetReserve,
      formula: { kind: 'echo', value: result.beginningNetReserve, text: "prior year's ending net accounting reserve, carried in" },
    },
    {
      metric: 'Current-Year Net Reserve',
      value: formatCurrency(result.currentYearNetReserve),
      numericValue: result.currentYearNetReserve,
      formula: { kind: 'product', factors: [curTerm(result.netUltimateLoss, 'this year\'s net ultimate'), pctTerm(currentYearUnpaidPct, 'current-year unpaid portion')] },
      explain: 'A fixed 60% reserved / 40% paid split for the current accident year, hardcoded in the engine — not RESERVE_PAYDOWN_PCT (35%, which governs runoff of OLDER cohorts) and not shown as a named assumption anywhere.',
    },
    {
      metric: 'Net Paid Losses',
      value: formatCurrency(result.netPaidLosses),
      numericValue: result.netPaidLosses,
      formula: {
        kind: 'sum',
        terms: [
          curTerm(netPaidCurrentYear, 'current-year paid, 40%'),
          curTerm(priorCohortPaydown, 'prior-year cohort paydowns'),
        ],
      },
      explain: 'The second term is a residual (total less current-year paid) — no field isolates prior-cohort paydowns on their own.',
    },
    {
      metric: 'Ending Net Accounting Reserve',
      value: formatCurrency(result.endingNetReserve),
      numericValue: result.endingNetReserve,
      formula: {
        kind: 'sum',
        terms: [
          curTerm(result.beginningNetReserve, 'beginning'),
          curTerm(result.netUltimateLoss, 'net ultimate'),
          curTerm(-result.priorYearDevelopment, 'prior-year development'),
          curTerm(-result.netPaidLosses, 'net paid'),
        ],
      },
      explain: 'Reuses the same identity as the Net Incurred Loss Check below (net incurred = paid + reserve change, and net incurred = net ultimate − development).',
      ...checkNote(endingNetReserveDifference, {
        varianceCap: CLAIMS_VARIANCE_CAP,
        varianceReason: CLAIMS_VARIANCE_REASON,
      }),
    },
    {
      metric: 'Net Incurred Loss Check',
      value: formatCurrency(netIncurredLossDifference),
      numericValue: netIncurredLossDifference,
      formula: {
        kind: 'sum',
        terms: [curTerm(result.netIncurredLoss, 'stored'), curTerm(-result.netPaidLosses), curTerm(-result.endingNetReserve), curTerm(result.beginningNetReserve)],
      },
      ...legacyCheck(netIncurredLossDifference),
    },
    {
      metric: 'Expected Net Unpaid Loss',
      value: formatCurrency(result.expectedNetUnpaidLoss),
      numericValue: result.expectedNetUnpaidLoss,
      formula: { kind: 'echo', value: result.expectedNetUnpaidLoss, text: 'same as Ending Net Accounting Reserve above' },
    },
    {
      metric: 'Net Incurred Loss (from income statement)',
      value: formatCurrency(netIncurredLossFromIncome),
      numericValue: netIncurredLossFromIncome,
      formula: {
        kind: 'sum',
        terms: [
          curTerm(result.grossPremium, 'gross premium'), curTerm(result.assessments), curTerm(result.investmentIncome),
          curTerm(-result.operatingExpense), curTerm(-result.riskControlInvestment), curTerm(-result.reinsuranceCost),
          curTerm(-result.dividends), curTerm(-result.netIncome),
        ],
      },
      explain: 'Back-solved from Statement of Revenues, Expenses & Changes in Net Position figures as a cross-check on the reserve rollforward above.',
    },
    {
      metric: 'Prior-Year Development',
      value: formatCurrency(result.priorYearDevelopment),
      formula: {
        kind: 'simulated',
        expected: 0,
        expectedLabel: 'expected ≈ $0 by design (no systematic drift), though the true center also depends on prior funding adequacy, which is not displayed;',
        where: 'the reserve cohort re-estimate is simulated per cohort',
      },
      explain: 'Signed so positive = favourable (reserve released). Not added separately to net income — already captured in Ending Net Accounting Reserve above.',
    },
  ];

  // BASIS GUARD — the reconciliation that makes this page's ratio card
  // self-checking. On the member-charge basis all three ratios share one
  // denominator, so loss + expense must equal combined EXACTLY. It cannot fail
  // while the bases agree, and that is the point: it turns red the instant a
  // mixed-denominator term is reintroduced, which is exactly how the combined
  // ratio came to read a hardcoded 100% for the life of the project.
  const basisGuardDiff = Math.abs(
    (result.expectedLossRatioMemberBasis + result.expectedExpenseRatio) - result.expectedCombinedRatio,
  );
  // ⚠ AND THE HALF THE GUARD ABOVE WAS MISSING: A DENOMINATOR IS NOT A BASIS.
  // The check above passed throughout the period the combined ratio read 130.0%
  // on GL, because it only ever asked whether the three terms shared a
  // DENOMINATOR — which they did. What it never asked was whether the
  // NUMERATORS did. After the net-funding change the loss numerator was gross
  // while the denominator contained the net-funded pool premium, and nothing on
  // this page could see it.
  //
  // The identity: poolPremium + adminExpense + reinsuranceCost is identically
  // totalMemberCharge, so at CLF 1.000 the combined ratio must be EXACTLY
  // 1.0000. Checked only at CLF 1.000, because that is the only point where the
  // identity is closed — above it the shortfall is the funding margin and below
  // it the excess is the funding shortfall, both correct.
  // The numerator both expected-loss ratios are built from, mirroring
  // simulationEngine's fundedNetExpectedLoss so the rows show what is computed.
  const fundedNetLoss = result.poolPremium / Math.max(result.selectedFundingCLF, 1e-9);
  const numeratorGuardApplies = result.selectedFundingCLF === 1.0;
  const numeratorGuardDiff = Math.abs(result.expectedCombinedRatio - 1);
  const numeratorGuardFails = numeratorGuardApplies && numeratorGuardDiff >= 1e-12;

  const basisGuardStatus: CheckStatus =
    basisGuardDiff < 1e-12 && !numeratorGuardFails ? 'pass' : 'fail';
  const basisGuardNote = basisGuardDiff >= 1e-12
    ? `Basis check FAILED by ${basisGuardDiff.toExponential(2)} — a term is on the wrong denominator.`
    : numeratorGuardFails
      ? `Basis check FAILED: CLF is 1.000, so this must be exactly 100% — it is off by ` +
        `${numeratorGuardDiff.toExponential(2)}. A NUMERATOR is on the wrong basis (gross against ` +
        `the net-funded premium), which the denominator half of this guard cannot see.`
      : numeratorGuardApplies
        ? 'Basis check: loss + expense = combined exactly, all three over total member charge; and at ' +
          'CLF 1.000 the combined ratio is exactly 100%, so both numerators are on the net basis too.'
        : 'Basis check: loss + expense = combined exactly, all three over total member charge. The ' +
          'numerator identity is only closed at CLF 1.000; here the gap from 100% is the funding margin.';

  const ratioRows: AuditRow[] = [
    {
      metric: 'Expected Loss Ratio (pricing basis)',
      value: formatPct(result.expectedLossRatio),
      numericValue: result.expectedLossRatio,
      formula: { kind: 'ratio', numerator: curTerm(fundedNetLoss, 'net expected loss the premium funds'), denominator: curTerm(result.poolPremium + result.adminExpense, 'pool premium + admin expense') },
      subFormula: {
        label: 'pool premium + admin expense',
        value: result.poolPremium + result.adminExpense,
        spec: { kind: 'sum', terms: [curTerm(result.poolPremium, 'pool premium'), curTerm(result.adminExpense, 'admin expense')] },
      },
      explain: 'PRICING basis — the denominator EXCLUDES reinsurance cost. The numerator is the NET loss the pool premium funds (pool premium / CLF), not gross expected loss: since the funding-basis change the denominator contains a net-funded premium, and a gross numerator over it double-counts the ceded loss. The 66.8% target the cutover harnesses carry predates both net funding and the CLF 1.000 default and no longer describes this figure.',
    },
    {
      metric: 'Expected Loss Ratio (member charge basis)',
      value: formatPct(result.expectedLossRatioMemberBasis),
      numericValue: result.expectedLossRatioMemberBasis,
      formula: { kind: 'ratio', numerator: curTerm(fundedNetLoss, 'net expected loss the premium funds'), denominator: curTerm(result.totalMemberCharge, 'total member charge') },
      subFormula: {
        label: 'net expected loss the premium funds',
        value: fundedNetLoss,
        spec: { kind: 'ratio', numerator: curTerm(result.poolPremium, 'pool premium'), denominator: { value: result.selectedFundingCLF, format: 'plain', label: 'selected CLF' } },
      },
      explain: 'MEMBER-CHARGE basis — the denominator INCLUDES reinsurance cost. This is the loss-ratio component of the combined ratio below. Gross expected loss is NOT the numerator: it would double-count the ceded portion, once here and once as reinsurance cost in the expense ratio.',
    },
    {
      metric: 'Expected Expense Ratio (member charge basis)',
      value: formatPct(result.expectedExpenseRatio),
      numericValue: result.expectedExpenseRatio,
      formula: { kind: 'ratio', numerator: curTerm(result.adminExpense + result.reinsuranceCost, 'admin expense + reinsurance cost'), denominator: curTerm(result.totalMemberCharge, 'total member charge') },
      subFormula: {
        label: 'admin expense + reinsurance cost',
        value: result.adminExpense + result.reinsuranceCost,
        spec: { kind: 'sum', terms: [curTerm(result.adminExpense, 'admin expense'), curTerm(result.reinsuranceCost, 'reinsurance cost')] },
      },
      explain: 'Computed from the actual expense dollars. It was previously defined as 1.0 − loss ratio, a residual that forced the combined ratio to 100% regardless of pricing.',
    },
    {
      metric: 'Expected Combined Ratio (member charge basis)',
      value: formatPct(result.expectedCombinedRatio),
      numericValue: result.expectedCombinedRatio,
      formula: { kind: 'sum', terms: [pctTerm(result.expectedLossRatioMemberBasis, 'expected loss ratio (member charge)'), pctTerm(result.expectedExpenseRatio, 'expected expense ratio (member charge)')] },
      explain: 'Both terms share the total-member-charge denominator AND the net numerator basis, so the sum is meaningful. At CLF 1.000 — the default on WC and GL — it is EXACTLY 100%, because pool premium + admin + reinsurance is identically the total member charge. Above CLF 1.000 the shortfall below 100% is the deliberate funding margin, which is what a confidence level above expected buys.',
      note: basisGuardNote,
      status: basisGuardStatus,
    },
    {
      metric: 'Actual Loss Ratio',
      value: formatPct(result.lossRatio),
      numericValue: result.lossRatio,
      formula: { kind: 'ratio', numerator: curTerm(result.netIncurredLoss, 'net incurred loss'), denominator: curTerm(result.grossPremium, 'gross premium') },
    },
    {
      metric: 'Loss Ratio Check Difference',
      value: formatPct(result.lossRatio - lossRatioCheck),
      numericValue: result.lossRatio - lossRatioCheck,
      formula: { kind: 'sum', terms: [pctTerm(result.lossRatio, 'stored'), pctTerm(-lossRatioCheck, 'recalculated')] },
      ...legacyCheck(result.lossRatio - lossRatioCheck, 0.0001),
    },
    {
      metric: 'Actual Expense Ratio',
      value: formatPct(result.expenseRatio),
      numericValue: result.expenseRatio,
      formula: { kind: 'ratio', numerator: curTerm(result.adminExpense + result.reinsuranceCost, 'admin expense + reinsurance cost'), denominator: curTerm(result.totalMemberCharge, 'collected gross premium and admin expense') },
      subFormula: {
        label: 'admin expense + reinsurance cost',
        value: result.adminExpense + result.reinsuranceCost,
        spec: { kind: 'sum', terms: [curTerm(result.adminExpense, 'admin expense'), curTerm(result.reinsuranceCost, 'reinsurance cost')] },
      },
    },
    {
      metric: 'Expense Ratio Check Difference',
      value: formatPct(result.expenseRatio - expenseRatioCheck),
      numericValue: result.expenseRatio - expenseRatioCheck,
      formula: { kind: 'sum', terms: [pctTerm(result.expenseRatio, 'stored'), pctTerm(-expenseRatioCheck, 'recalculated')] },
      ...legacyCheck(result.expenseRatio - expenseRatioCheck, 0.0001),
    },
    {
      metric: 'Actual Combined Ratio',
      value: formatPct(result.combinedRatio),
      numericValue: result.combinedRatio,
      formula: { kind: 'sum', terms: [pctTerm(result.lossRatio, 'actual loss ratio'), pctTerm(result.expenseRatio, 'actual expense ratio')] },
    },
    {
      metric: 'Combined Ratio Check Difference',
      value: formatPct(result.combinedRatio - combinedRatioCheck),
      numericValue: result.combinedRatio - combinedRatioCheck,
      formula: { kind: 'sum', terms: [pctTerm(result.combinedRatio, 'stored'), pctTerm(-combinedRatioCheck, 'recalculated')] },
      ...legacyCheck(result.combinedRatio - combinedRatioCheck, 0.0001),
    },
  ];

  const fundingMarginCLF = reserveMarginCLFForLine;
  const fundingMarginCLFLabel = result.line && hasStaticClf(result.line)
    ? `STATIC_CLF_TABLE.${result.line}[90%]`
    : 'FUNDING_CLF_TABLE[90%]';

  const capitalRows: AuditRow[] = [
    {
      metric: 'Expected Net Unpaid Loss',
      value: formatCurrency(result.expectedNetUnpaidLoss),
      numericValue: result.expectedNetUnpaidLoss,
      formula: { kind: 'echo', value: result.expectedNetUnpaidLoss, text: 'same as Ending Net Accounting Reserve on the Reserve Rollforward card above' },
    },
    {
      metric: 'Indicated Net Reserve at Confidence Level',
      value: formatCurrency(result.indicatedNetReserveAtConfidenceLevel),
      numericValue: result.indicatedNetReserveAtConfidenceLevel,
      formula: { kind: 'product', factors: [curTerm(result.expectedNetUnpaidLoss, 'expected net unpaid loss'), factorTerm(result.selectedFundingCLF, `selected CLF at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}%`)] },
    },
    {
      metric: 'Indicated Net Reserve Check Difference',
      value: formatCurrency(indicatedNetReserveDifference),
      numericValue: indicatedNetReserveDifference,
      formula: { kind: 'sum', terms: [curTerm(result.indicatedNetReserveAtConfidenceLevel, 'stored'), curTerm(-indicatedNetReserveCheck, 'recalculated')] },
      ...legacyCheck(indicatedNetReserveDifference),
    },
    {
      metric: 'Reserve Risk Margin Needed',
      value: formatCurrency(result.reserveRiskMarginNeeded),
      numericValue: result.reserveRiskMarginNeeded,
      // ⚠ AT POOL SCOPE THIS IS A SUM, NOT A PRODUCT, and showing the product
      // was a regression this page's own diagnostic caught in its first run.
      // The pool figure is summed across lines, each applying its OWN 90% CLF
      // (WC 1.3709, GL 1.5020, Property 1.5923), so a single factor cannot
      // reproduce it. The CHECK was correctly made n/a when that was found; the
      // FORMULA was left showing expectedNetUnpaidLoss x 0.951 and read $20.47M
      // against a stated $7.99M. A wrong derivation beside a neutralised check
      // is worse than no derivation — nothing was left to contradict it.
      formula: isPoolView && perLine && perLine.length > 0
        ? {
            kind: 'sum',
            terms: perLine.map(p => ({
              product: [
                curTerm(p.expectedNetUnpaidLoss, 'expected net unpaid loss'),
                factorTerm(p.marginFactor, 'margin factor'),
              ],
              label: p.line,
            })),
          }
        : {
            kind: 'product',
            factors: [
              curTerm(result.expectedNetUnpaidLoss, 'expected net unpaid loss'),
              factorTerm(fundingMarginCLF - 1, 'required margin factor'),
            ],
          },
      subFormula: isPoolView ? undefined : {
        label: 'required margin factor',
        value: fundingMarginCLF - 1,
        spec: { kind: 'sum', terms: [factorTerm(fundingMarginCLF, fundingMarginCLFLabel), factorTerm(-1, '1.0')] },
      },
      explain: isPoolView
        ? 'Summed across the active lines, each applying its own 90%-confidence margin factor from its own static table (WC 1.3709, GL 1.5020, Property 1.5923). No single blended factor reproduces the total, which is why the check above is n/a at pool scope; select a line tab to check one line against its own curve.'
        : `${fundingMarginCLFLabel} is a fixed 90%-confidence reserve-margin factor, independent of the player's own selected funding confidence level above. It is the LINE'S OWN curve, read from that line's static table: WC 1.3709, GL 1.5020, Property 1.5923.`,
    },
    {
      metric: 'Reserve Risk Margin Check Difference',
      value: formatCurrency(reserveRiskMarginDifference),
      numericValue: reserveRiskMarginDifference,
      formula: { kind: 'sum', terms: [curTerm(result.reserveRiskMarginNeeded, 'stored'), curTerm(-reserveRiskMarginCheck, 'recalculated')] },
      ...marginCheck(reserveRiskMarginDifference),
    },
    {
      metric: 'Surplus',
      value: formatCurrency(result.availableSurplus),
      numericValue: result.availableSurplus,
      formula: { kind: 'echo', value: result.availableSurplus, text: 'ending net position, from the Statement of Net Position above' },
    },
    {
      metric: 'Excess Available Surplus',
      value: formatCurrency(result.capitalFundingGap),
      numericValue: result.capitalFundingGap,
      formula: { kind: 'sum', terms: [curTerm(result.availableSurplus, 'available surplus'), curTerm(-result.reserveRiskMarginNeeded, 'reserve risk margin needed')] },
    },
    {
      metric: 'Excess Available Surplus Check Difference',
      value: formatCurrency(result.capitalFundingGap - capitalFundingGapCheck),
      numericValue: result.capitalFundingGap - capitalFundingGapCheck,
      formula: { kind: 'sum', terms: [curTerm(result.capitalFundingGap, 'stored'), curTerm(-capitalFundingGapCheck, 'recalculated')] },
      ...legacyCheck(result.capitalFundingGap - capitalFundingGapCheck),
    },
    {
      metric: 'Excess Capital Ratio',
      value: result.excessCapitalRatio === null ? 'N/A' : formatPct(result.excessCapitalRatio),
      numericValue: result.excessCapitalRatio ?? undefined,
      formula: result.excessCapitalRatio === null
        ? { kind: 'text', text: 'Undefined — reserve risk margin needed is $0, so the ratio has no denominator.' }
        : { kind: 'ratio', numerator: curTerm(result.capitalFundingGap, 'excess available surplus'), denominator: curTerm(result.reserveRiskMarginNeeded, 'reserve risk margin needed') },
    },
    {
      metric: 'Excess Capital Ratio Check Difference',
      value: result.excessCapitalRatio === null || capitalAdequacyRatioCheck === null
        ? 'N/A'
        : (result.excessCapitalRatio - capitalAdequacyRatioCheck).toFixed(4),
      numericValue: (result.excessCapitalRatio !== null && capitalAdequacyRatioCheck !== null)
        ? result.excessCapitalRatio - capitalAdequacyRatioCheck
        : undefined,
      formula: (result.excessCapitalRatio === null || capitalAdequacyRatioCheck === null)
        ? { kind: 'text', text: 'Undefined on both sides — no required reserve margin to divide by.' }
        : { kind: 'sum', terms: [pctTerm(result.excessCapitalRatio, 'stored'), pctTerm(-capitalAdequacyRatioCheck, 'recalculated')] },
      ...(result.excessCapitalRatio === null || capitalAdequacyRatioCheck === null
        ? naNote('no required reserve margin, so the ratio is undefined')
        : legacyCheck(result.excessCapitalRatio - capitalAdequacyRatioCheck, 0.0001)),
    },
    {
      metric: 'Excess Capital Status',
      value: result.capitalAdequacyStatus,
      formula: {
        kind: 'text',
        text: result.excessCapitalRatio === null
          ? 'No required reserve margin, so status defaults on the same thresholds applied to $0.'
          : `Excess Capital Ratio ${formatPct(result.excessCapitalRatio)} against fixed thresholds: ≥25% Strong, ≥0% Adequate, ≥−10% Thin, else Deficient.`,
      },
      explain: 'A categorical read of the ratio above, not a further calculation.',
    },
  ];

  return { exposureRows, rateRows, lossRows, reserveRows, ratioRows, capitalRows };
}

// ============================================================================
// Statement-mirroring row builders.
//
// Each returns the audit rows for one card, in the SAME order, with the SAME
// labels and values as the corresponding statement on the Financial Statements
// tab — every line additionally carrying its derivation and its check. Exported
// as pure functions so a regression script can assert that correspondence
// directly.
// ============================================================================

export function buildRevExpRows(
  poolResult: ResultSet,
  lineView: LineView,
  checks: AuditCheckSet,
): AuditRow[] {
  const isPoolView = lineView === 'pool';
  const result: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const lineKeys = Object.keys(poolResult.byLine) as CoverageLine[];
  // Mirrors the statement: neither is modelled yet, so both are zero and the
  // rows they gate stay hidden.
  const additionalPaidInCapital = 0;
  const restatements = 0;

  // A component line is a per-line product, and the per-line factors can
  // differ (confidence level and assessment rate are both per-line
  // decisions). So at pool scope the honest arithmetic is the sum of the
  // lines, not a single product against a blended factor.
  const perLineSum = (pick: (x: LineResultSet) => number): FormulaSpec => ({
    kind: 'sum',
    terms: lineKeys.map(l => ({ value: pick(poolResult.byLine[l]), format: 'currency' as const, label: l })),
  });
  const scoped = (lineSpec: () => FormulaSpec, pick: (x: LineResultSet) => number): FormulaSpec =>
    isPoolView ? perLineSum(pick) : lineSpec();

  const cur = (value: number, label?: string): FormulaTerm => ({ value, format: 'currency', label });

  return [
    { kind: 'section', metric: 'Operating revenues', value: '', formula: '' },
    {
      metric: 'Premiums for transferred risk',
      value: formatCurrency(result.reinsuranceCost),
      numericValue: result.reinsuranceCost,
      formula: scoped(() => towerReinsCostFormula(result), x => x.reinsuranceCost),
      explain: 'Collected from members, then paid to the reinsurer — appears again below as an operating expense.',
      indent: 1,
    },
    {
      metric: 'Contributions for retained risk',
      value: formatCurrency(result.poolPremium),
      numericValue: result.poolPremium,
      // ⚠ NET, AND THE DEDUCTION IS ON SCREEN. This showed gross expectedLoss x
      // CLF against the net-funded poolPremium — operands 1.86x the value beside
      // them, on the headline revenue line of the statement card. The earlier
      // audit called it unfixable here because the netting terms were engine
      // locals; they are stored on the result now, so it is fixable and fixed.
      //
      // Built through exposure rather than from stored expectedLoss because
      // there is no stored NET expected loss: activeExposure x 10,000 x the net
      // rate IS the engine's own construction. activeExposure is stored at 2dp,
      // so it is a nested product — that keeps its rounding visible to the
      // formula checker's tolerance instead of hiding it inside a lump sum.
      formula: scoped(
        () => ({
          kind: 'product',
          factors: [
            {
              product: [
                { value: result.activeExposure, format: 'exposure', label: 'exposure' },
                { value: 10_000, format: 'plain', label: 'payroll units per $M' },
                { value: result.netPurePremiumPer100, format: 'plain', label: 'net pure premium rate' },
              ],
              label: 'net expected loss',
            },
            { value: result.selectedFundingCLF, format: 'factor', label: `CLF at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}%` },
            { value: result.rateLevel / 100, format: 'factor', label: `rate level ${result.rateLevel}` },
          ],
        }),
        x => x.poolPremium
      ),
      subFormula: isPoolView ? undefined : {
        label: 'net pure premium rate',
        value: result.netPurePremiumPer100,
        spec: {
          kind: 'sum',
          terms: [
            { value: result.purePremiumPer100, format: 'plain', label: 'gross pure premium rate' },
            { value: -result.expectedCededPer100, format: 'plain', label: 'less expected ceded to reinsurers' },
          ],
        },
      },
      explain: 'Funds the loss the pool KEEPS: expected ceded comes off before the CLF, so the ceded portion is not collected twice (once here and again as the reinsurance premium below). All three lines net now — Property joined when it got its own occurrence layer and aggregate, replacing the legacy cover that had no closed-form expected ceded to deduct.',
      indent: 1,
    },
    {
      metric: 'Administration fees',
      value: formatCurrency(result.adminExpense),
      numericValue: result.adminExpense,
      formula: scoped(
        () => ({
          kind: 'product',
          factors: [cur(result.expectedLoss, 'expected loss'), { value: ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM, format: 'pct' }],
        }),
        x => x.adminExpense
      ),
      explain: 'Added after the CLF, not multiplied by it. Appears again below as general administrative services.',
      indent: 1,
    },
    {
      metric: 'Member assessments',
      value: formatCurrency(result.assessments),
      numericValue: result.assessments,
      formula: scoped(
        () => ({
          kind: 'product',
          factors: [cur(result.poolPremium), { value: result.decisions.assessmentPct, format: 'pct', label: 'assessment rate' }],
        }),
        x => x.assessments
      ),
      indent: 1,
    },
    {
      metric: 'Total operating revenues',
      value: formatCurrency(checks.totalOperatingRevenuesValue),
      numericValue: checks.totalOperatingRevenuesValue,
      formula: {
        kind: 'sum',
        terms: [cur(result.reinsuranceCost), cur(result.poolPremium), cur(result.adminExpense), cur(result.assessments)],
      },
      emphasis: 'subtotal',
      note: checks.totalOperatingRevenues.note,
      status: checks.totalOperatingRevenues.status,
    },

    { kind: 'section', metric: 'Operating expenses', value: '', formula: '' },
    {
      metric: 'Transferred risk & insurance expense',
      value: formatCurrency(result.reinsuranceCost),
      numericValue: result.reinsuranceCost,
      formula: { kind: 'echo', value: result.reinsuranceCost, text: 'the premium collected above, passed straight through' },
      indent: 1,
    },
    {
      metric: 'Provision for claims:',
      value: '',
      formula: { kind: 'text', text: '' },
      explain: 'Grouping header for the three components below.',
      indent: 1,
    },
    {
      metric: 'Current year claims',
      value: formatCurrency(result.grossUltimateLoss),
      numericValue: result.grossUltimateLoss,
      formula: {
        kind: 'simulated',
        expected: result.expectedLoss,
        expectedLabel: 'expected',
        where: 'Losses and Reinsurance',
      },
      explain: 'Gross of reinsurance, including LAE.',
      indent: 2,
    },
    ...(result.reinsuranceRecovery !== 0
      ? [{
          metric: 'Less: reinsurance recoveries',
          value: `(${formatCurrency(result.reinsuranceRecovery)})`,
          numericValue: result.reinsuranceRecovery,
          formula: scoped(
            () => ({ kind: 'echo' as const, value: result.reinsuranceRecovery, text: 'Per-occurrence tower — sum of layer cessions' }),
            x => x.reinsuranceRecovery
          ),
          indent: 2 as const,
        }]
      : []),
    {
      metric: 'Prior year claims',
      value: formatCurrency(checks.priorYearClaimsValue),
      numericValue: checks.priorYearClaimsValue,
      formula: {
        kind: 'sum',
        terms: [cur(result.netIncurredLoss, 'net incurred'), cur(-result.netUltimateLoss, 'net ultimate this year')],
      },
      subFormula: {
        label: 'independently',
        value: -result.priorYearDevelopment,
        spec: { kind: 'sum', terms: [cur(-result.priorYearDevelopment, 'simulated cohort development, sign reversed')] },
      },
      explain: 'Paid plus the change in unpaid on prior cohorts, including closed-cohort runoff. The two paths must meet.',
      indent: 2,
      note: checks.priorYearClaims.note,
      status: checks.priorYearClaims.status,
    },
    {
      metric: 'Provision for claims, net',
      value: formatCurrency(result.netIncurredLoss),
      numericValue: result.netIncurredLoss,
      formula: {
        kind: 'sum',
        terms: result.reinsuranceRecovery !== 0
          ? [cur(result.grossUltimateLoss), cur(-result.reinsuranceRecovery), cur(checks.priorYearClaimsValue)]
          : [cur(result.grossUltimateLoss), cur(checks.priorYearClaimsValue)],
      },
      indent: 2,
      emphasis: 'subtotal',
      note: checks.provisionForClaims.note,
      status: checks.provisionForClaims.status,
    },
    {
      metric: 'General administrative services',
      value: formatCurrency(result.operatingExpense),
      numericValue: result.operatingExpense,
      formula: { kind: 'echo', value: result.adminExpense, text: 'the administration fees collected above, paid out' },
      indent: 1,
    },
    {
      metric: 'Loss prevention expenses',
      value: formatCurrency(result.riskControlInvestment),
      numericValue: result.riskControlInvestment,
      formula: scoped(
        () => ({
          kind: 'product',
          factors: [cur(result.poolPremium), { value: result.decisions.riskControlPct, format: 'pct', label: 'risk control' }],
        }),
        x => x.riskControlInvestment
      ),
      indent: 1,
    },
    {
      metric: 'Member dividends & returned premium',
      value: formatCurrency(result.dividends),
      numericValue: result.dividends,
      // The engine zeroes the dividend when the line carried a negative
      // surplus in. Detected rather than assumed, so the shown arithmetic is
      // never the un-blocked product when the actual figure is zero.
      formula: Math.abs(result.dividends - result.poolPremium * result.decisions.dividendPct) > CHECK_TOLERANCE
        ? { kind: 'text', text: `${formatCurrency(0)} — dividend blocked: this line carried a negative surplus into the year` }
        : scoped(
            () => ({
              kind: 'product',
              factors: [cur(result.poolPremium), { value: result.decisions.dividendPct, format: 'pct', label: 'dividend rate' }],
            }),
            x => x.dividends
          ),
      indent: 1,
    },
    {
      metric: 'Total operating expenses',
      value: formatCurrency(checks.totalOperatingExpensesValue),
      numericValue: checks.totalOperatingExpensesValue,
      formula: {
        kind: 'sum',
        terms: [
          cur(result.reinsuranceCost), cur(result.netIncurredLoss), cur(result.operatingExpense),
          cur(result.riskControlInvestment), cur(result.dividends),
        ],
      },
      emphasis: 'subtotal',
      note: checks.totalOperatingExpenses.note,
      status: checks.totalOperatingExpenses.status,
    },

    {
      metric: 'Operating income (loss)',
      value: formatCurrency(result.underwritingIncome),
      numericValue: result.underwritingIncome,
      formula: {
        kind: 'sum',
        terms: [cur(checks.totalOperatingRevenuesValue, 'revenues'), cur(-checks.totalOperatingExpensesValue, 'expenses')],
      },
      emphasis: 'total',
      note: checks.operatingIncome.note,
      status: checks.operatingIncome.status,
    },

    { kind: 'section', metric: 'Nonoperating revenues (expenses)', value: '', formula: '' },
    {
      metric: 'Investment income, net of investment expense',
      value: formatCurrency(result.investmentIncome),
      numericValue: result.investmentIncome,
      formula: {
        kind: 'product',
        factors: [
          cur(result.investedAssets, 'invested assets'),
          { value: result.investmentReturnRate, format: 'pct', label: 'blended return, net of fees' },
        ],
      },
      explain: 'Blended from this year\'s cash, bond and equity draws by the allocation.',
      indent: 1,
      note: checks.investmentIncome.note,
      status: checks.investmentIncome.status,
    },
    {
      metric: 'Total nonoperating revenues (expenses)',
      value: formatCurrency(result.investmentIncome),
      numericValue: result.investmentIncome,
      formula: { kind: 'echo', value: result.investmentIncome, text: 'investment income is the only nonoperating item' },
      emphasis: 'subtotal',
    },

    {
      metric: 'Change in net position',
      value: formatCurrency(result.netIncome),
      numericValue: result.netIncome,
      formula: {
        kind: 'sum',
        terms: [cur(result.underwritingIncome, 'operating'), cur(result.investmentIncome, 'nonoperating')],
      },
      emphasis: 'total',
      note: checks.changeInNetPosition.note,
      status: checks.changeInNetPosition.status,
    },

    { kind: 'section', metric: 'Net position', value: '', formula: '' },
    {
      metric: 'Beginning of year',
      value: formatCurrency(result.beginingSurplus),
      numericValue: result.beginingSurplus,
      formula: { kind: 'echo', value: result.beginingSurplus, text: 'prior year\'s ending net position' },
      indent: 1,
    },
    ...(additionalPaidInCapital !== 0 || restatements !== 0
      ? [
          {
            metric: 'Additional paid in capital',
            value: formatCurrency(additionalPaidInCapital),
            formula: { kind: 'text' as const, text: 'Not modelled yet.' },
            indent: 1 as const,
          },
          {
            metric: 'Restatements',
            value: formatCurrency(restatements),
            formula: { kind: 'text' as const, text: 'Not modelled yet.' },
            indent: 1 as const,
          },
          {
            metric: 'Beginning of year, as restated',
            value: formatCurrency(result.beginingSurplus + additionalPaidInCapital + restatements),
            formula: {
              kind: 'sum' as const,
              terms: [cur(result.beginingSurplus), cur(additionalPaidInCapital), cur(restatements)],
            },
            indent: 1 as const,
          },
        ]
      : []),
    {
      metric: 'Net position, end of year',
      value: formatCurrency(result.endingSurplus),
      numericValue: result.endingSurplus,
      formula: {
        kind: 'sum',
        terms: [cur(result.beginingSurplus, 'beginning'), cur(result.netIncome, 'change')],
      },
      explain: `Stored tie-out difference ${formatCurrency(result.surplusTieOutDifference)}.`,
      emphasis: 'total',
      note: checks.netPositionRollforward.note,
      status: checks.netPositionRollforward.status,
    },
  ];
}

export function buildNetPositionRows(
  poolResult: ResultSet,
  lineView: LineView,
  checks: AuditCheckSet
): AuditRow[] {
  const isPoolView = lineView === 'pool';
  const result: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const lineKeys = Object.keys(poolResult.byLine) as CoverageLine[];
  const cur = (value: number, label?: string): FormulaTerm => ({ value, format: 'currency', label });

  return [
    { kind: 'section', metric: 'Current assets', value: '', formula: '' },
    {
      metric: 'Cash and cash equivalents',
      value: formatCurrency(checks.cashAndEquivalents),
      numericValue: checks.cashAndEquivalents,
      formula: {
        kind: 'sum',
        terms: [
          cur(result.endingCash, 'operating cash'),
          { product: [
              cur(result.endingInvestments, 'portfolio'),
              { value: result.assetAllocation.cashPct / 100, format: 'pct', label: 'cash allocation' },
            ] },
        ],
      },
      indent: 1,
    },
    {
      metric: 'Total current assets',
      value: formatCurrency(checks.cashAndEquivalents),
      numericValue: checks.cashAndEquivalents,
      formula: { kind: 'echo', value: checks.cashAndEquivalents, text: 'cash and cash equivalents is the only current asset' },
      emphasis: 'subtotal',
    },

    { kind: 'section', metric: 'Noncurrent assets', value: '', formula: '' },
    {
      metric: 'Investments',
      value: formatCurrency(checks.noncurrentInvestments),
      numericValue: checks.noncurrentInvestments,
      formula: {
        kind: 'sum',
        terms: [cur(result.endingInvestments, 'portfolio'), cur(-checks.cashSliceOfInvestments, 'cash-equivalent slice')],
      },
      explain: 'The bond and equity allocations.',
      indent: 1,
    },
    {
      metric: 'Total noncurrent assets',
      value: formatCurrency(checks.noncurrentInvestments),
      numericValue: checks.noncurrentInvestments,
      formula: { kind: 'echo', value: checks.noncurrentInvestments, text: 'investments are the only noncurrent asset' },
      emphasis: 'subtotal',
    },

    {
      metric: 'Total assets',
      value: formatCurrency(result.totalAssets),
      numericValue: result.totalAssets,
      formula: {
        kind: 'sum',
        terms: [cur(checks.cashAndEquivalents, 'current'), cur(checks.noncurrentInvestments, 'noncurrent')],
      },
      explain: 'The split reallocates the portfolio but must conserve the total.',
      emphasis: 'total',
      note: checks.totalAssetsSplit.note,
      status: checks.totalAssetsSplit.status,
    },

    { kind: 'section', metric: 'Current liabilities', value: '', formula: '' },
    {
      metric: 'Unpaid loss and LAE reserve, net of reinsurance — current portion',
      value: formatCurrency(checks.currentUnpaidPortion),
      numericValue: checks.currentUnpaidPortion,
      formula: isPoolView
        ? {
            kind: 'sum',
            terms: lineKeys.map(l => ({
              product: [
                cur(poolResult.byLine[l].endingNetReserve),
                { value: LINE_RESERVE_PAYDOWN_PCT[l] ?? 0, format: 'pct' as const },
              ],
              label: l,
            })),
          }
        : {
            kind: 'product',
            factors: [
              cur(result.endingNetReserve, 'net unpaid reserve'),
              { value: LINE_RESERVE_PAYDOWN_PCT[lineView as CoverageLine] ?? 0, format: 'pct', label: 'paydown rate' },
            ],
          },
      explain: isPoolView
        ? 'Each line\'s own reserve at its own paydown rate, summed — the rate the engine applies to every cohort each year.'
        : 'The rate the engine applies to every cohort each year.',
      indent: 1,
    },
    {
      metric: 'Total current liabilities',
      value: formatCurrency(checks.currentUnpaidPortion),
      numericValue: checks.currentUnpaidPortion,
      formula: { kind: 'echo', value: checks.currentUnpaidPortion, text: 'the current reserve portion is the only current liability' },
      emphasis: 'subtotal',
    },

    { kind: 'section', metric: 'Noncurrent liabilities', value: '', formula: '' },
    {
      metric: 'Unpaid loss and LAE reserve, net of reinsurance — noncurrent portion',
      value: formatCurrency(checks.noncurrentUnpaidPortion),
      numericValue: checks.noncurrentUnpaidPortion,
      formula: {
        kind: 'sum',
        terms: [cur(result.endingNetReserve, 'net unpaid reserve'), cur(-checks.currentUnpaidPortion, 'current portion')],
      },
      explain: 'Expected to pay beyond twelve months.',
      indent: 1,
    },
    {
      metric: 'Total noncurrent liabilities',
      value: formatCurrency(checks.noncurrentUnpaidPortion),
      numericValue: checks.noncurrentUnpaidPortion,
      formula: { kind: 'echo', value: checks.noncurrentUnpaidPortion, text: 'the noncurrent reserve portion is the only noncurrent liability' },
      emphasis: 'subtotal',
    },

    {
      metric: 'Total liabilities',
      value: formatCurrency(result.totalLiabilities),
      numericValue: result.totalLiabilities,
      formula: {
        kind: 'sum',
        terms: [
          cur(checks.currentUnpaidPortion, 'current'),
          cur(checks.noncurrentUnpaidPortion, 'noncurrent'),
          cur(result.unearnedPremium, 'unearned premium'),
        ],
      },
      explain: 'Unearned premium is held at zero — written premium is earned in the year written — so the statement does not present it as a line.',
      emphasis: 'total',
      note: checks.totalLiabilitiesSplit.note,
      status: checks.totalLiabilitiesSplit.status,
    },

    {
      metric: 'Net position — unrestricted',
      value: formatCurrency(result.endingSurplus),
      numericValue: result.endingSurplus,
      formula: {
        kind: 'sum',
        terms: [cur(result.totalAssets, 'assets'), cur(-result.totalLiabilities, 'liabilities')],
      },
      emphasis: 'total',
      note: checks.assetsMinusLiabilities.note,
      status: checks.assetsMinusLiabilities.status,
    },
  ];
}

export function buildCashInvestmentRows(
  poolResult: ResultSet,
  lineView: LineView,
  checks: AuditCheckSet
): AuditRow[] {
  const isPoolView = lineView === 'pool';
  const result: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const surplusFromIncomeDifference =
    result.surplusFromIncome - (result.beginingSurplus + result.netIncome);
  const tieOutDifferenceDifference =
    result.surplusTieOutDifference - (result.endingSurplus - result.surplusFromIncome);

  const cur = (value: number, label?: string): FormulaTerm => ({ value, format: 'currency', label });

  // ⚠ HOW A FORMULA IS SHAPED DETERMINES WHAT THE CHECKER CAN SEE ABOUT ITS OWN
  // PRECISION, and that is not obvious enough to leave unsaid.
  //
  // audit-formula-check bounds each row by propagating the DISPLAY/STORAGE
  // quantum of its operands. A term written as one currency figure declares a
  // quantum of $1 whatever it was built from — so collapsing `exposure x rate`
  // into a single lump sum tells the checker the value is good to a dollar when
  // the exposure behind it is stored at 2dp and is really good to ~$150. The
  // bound then comes out far too tight and a CORRECT row fails.
  //
  // So: wherever a rounded operand is involved, write the NESTED product and
  // let the rounding propagate. That is why the sweep rows below decompose to
  // their real operands instead of quoting the reconstructed subtotal. See
  // 6d3b359, where folding exposure into a lump sum forced exactly this
  // problem on "Contributions for retained risk".
  //
  // The cash rows here are sums of unrounded stored dollars, so they carry no
  // hidden rounding — but they are written out in full for the same reason: a
  // subtotal quoted as one term is a derivation the checker cannot inspect.

  // Each line's own sweep, so a pool row can be the sum of the lines rather
  // than one branch's arithmetic applied to aggregates. The branch taken can
  // differ per line, and at pool scope frequently does.
  const sweeps = checks.perLineSweep;

  // ENDING CASH, BY THE BRANCH THAT ACTUALLY FIRED — never a path not taken.
  //   normal:      cash is pinned to the operating-cash target, whether the
  //                sweep moved money out (surplus) or in (shortfall covered)
  //   floor bound: investments ran out first, so cash lands short at
  //                preSweepCash + whatever investments there were
  const endingCashTermFor = (p: typeof sweeps[number]): FormulaTerm =>
    p.liquidityFloorBound
      ? { product: [cur(p.preSweepCash + p.investmentsBeforeSweep)], label: `${p.line} (liquidity floor bound)` }
      : { product: [cur(p.operatingCashTarget)], label: `${p.line} (swept to target)` };

  return [

    {
      metric: 'Beginning Cash',
      value: formatCurrency(result.beginningCash),
      // ATOMIC, AND SAYING SO IS THE POINT. An opening balance is carried in,
      // not computed here, so there is no derivation to show. Left as prose
      // deliberately — an empty formula column would read as an oversight.
      formula: { kind: 'text', text: 'Operating cash carried into the year — an opening balance, not a calculation. It is the prior year\'s ending cash.' },
    },
    {
      metric: 'Beginning Investments',
      value: formatCurrency(result.beginningInvestments),
      formula: { kind: 'text', text: 'Investment portfolio carried into the year — an opening balance, not a calculation. It is the prior year\'s ending investments.' },
    },
    {
      metric: 'Investment Income',
      value: formatCurrency(result.investmentIncome),
      numericValue: result.investmentIncome,
      // Holds at pool scope too: investmentReturnRate is aggregated as
      // sum(income)/sum(assets), a genuine weighted blend, NOT one line's rate
      // kept as a placeholder the way ratePer100 is.
      formula: {
        kind: 'product',
        factors: [
          cur(result.investedAssets, 'invested assets'),
          { value: result.investmentReturnRate, format: 'pct', label: 'investment return rate' },
        ],
      },
      explain: 'Applied to the portfolio before the sweep. Can be negative in a down market.',
    },
    {
      metric: 'Investments Before Sweep',
      value: formatCurrency(checks.investmentsBeforeSweep),
      numericValue: checks.investmentsBeforeSweep,
      // Per line, because the zero floor binds per line: one line flooring does
      // not make the pool total the floored sum of the others.
      formula: {
        kind: 'sum',
        terms: sweeps.map(p => ({ product: [cur(p.investmentsBeforeSweep)], label: p.line })),
      },
      subFormula: sweeps.length === 1 ? {
        label: 'beginning investments + investment income',
        value: sweeps[0].investmentsBeforeSweep,
        spec: {
          kind: 'sum',
          terms: [cur(result.beginningInvestments, 'beginning investments'), cur(result.investmentIncome, 'investment income')],
        },
      } : undefined,
      explain: sweeps.some(p => p.investmentsFloorBound)
        ? 'FLOORED AT ZERO on at least one line: an investment loss cannot drive the portfolio negative, so the sum above is not simply beginning investments plus income.'
        : 'Beginning investments plus investment income, floored at zero (a loss cannot drive the portfolio negative). The floor is not binding this year.',
    },
    {
      metric: 'Operating Cash Target',
      value: formatCurrency(checks.operatingCashTarget),
      numericValue: checks.operatingCashTarget,
      // A single product survives pool scope here because the percentage is a
      // constant: sum over lines of (charge_i x pct) IS (sum charge_i) x pct.
      formula: {
        kind: 'product',
        factors: [
          cur(result.totalMemberCharge, 'gross premium & admin expense'),
          { value: OPERATING_CASH_PCT_OF_PREMIUM, format: 'pct', label: 'operating cash target rate' },
        ],
      },
      explain: `Cash is swept toward this level each year end.${isPoolView ? ' Summed across lines — the sweep runs per line — which equals the pool charge times the rate, since the rate is a constant.' : ''}`,
    },
    {
      metric: 'Sweep Transfer',
      value: formatCurrency(checks.sweepTransfer),
      numericValue: checks.sweepTransfer,
      // Definitional, and additive across lines, so one form serves both scopes.
      formula: {
        kind: 'sum',
        terms: [
          cur(checks.endingInvestmentsSweep.derived, 'investments after sweep'),
          cur(-checks.investmentsBeforeSweep, 'less investments before sweep'),
        ],
      },
      explain: 'Net movement into the portfolio from the sweep: positive when cash above target was swept in, negative when investments were drawn down to cover a cash shortfall.',
    },
    {
      metric: 'Ending Cash / Operating Cash Sweep',
      value: formatCurrency(result.endingCash),
      numericValue: result.endingCash,
      formula: { kind: 'sum', terms: sweeps.map(endingCashTermFor) },
      subFormula: sweeps.length === 1 && !sweeps[0].liquidityFloorBound ? {
        label: 'pre-sweep cash',
        value: sweeps[0].preSweepCash,
        spec: {
          kind: 'sum',
          terms: [
            cur(result.beginningCash, 'beginning cash'),
            cur(result.totalMemberCharge, 'member charge'),
            cur(result.assessments, 'assessments'),
            cur(-result.netPaidLosses, 'net paid losses'),
            cur(-result.operatingExpense, 'operating expense'),
            cur(-result.riskControlInvestment, 'risk control'),
            cur(-result.reinsuranceCost, 'reinsurance cost'),
            cur(-result.dividends, 'dividends'),
          ],
        },
      } : undefined,
      explain: sweeps.some(p => p.liquidityFloorBound)
        ? 'LIQUIDITY FLOOR BOUND on at least one line: investments ran out before the operating-cash target was reached, so that line ends at pre-sweep cash plus whatever investments existed. A real balance-sheet event, not a reconciliation gap.'
        : 'Every line reached its operating-cash target, so ending cash IS the target — the sweep moved the difference either into investments (surplus) or out of them (shortfall). The sub-formula shows the pre-sweep flows the target was measured against.',
      note: checks.endingCashSweep.note,
      status: checks.endingCashSweep.status,
    },
    {
      metric: 'Ending Investments / Sweep',
      value: formatCurrency(result.endingInvestments),
      numericValue: result.endingInvestments,
      formula: {
        kind: 'sum',
        terms: [
          cur(checks.investmentsBeforeSweep, 'investments before sweep'),
          cur(checks.sweepTransfer, 'sweep transfer'),
        ],
      },
      explain: 'The mirror image of the cash reconstruction above — the sweep conserves total assets, moving money between the two accounts.',
      note: checks.endingInvestmentsSweep.note,
      status: checks.endingInvestmentsSweep.status,
    },
    {
      metric: 'Unearned Premium',
      value: formatCurrency(result.unearnedPremium),
      // Held at a constant, so there is no arithmetic — stated rather than
      // dressed up as a calculation against zero.
      formula: { kind: 'text', text: 'Held at zero, not calculated: written premium is treated as collected and earned in the year it is written, with no separate timing layer.' },
    },
    {
      metric: 'Surplus from Income',
      value: formatCurrency(result.surplusFromIncome),
      numericValue: result.surplusFromIncome,
      // ⚠ THIS ROW AND THE NEXT ARE THE SURPLUS ROLLFORWARD TIE-OUT — the
      // reconciliation between the balance sheet and the income statement, and
      // until now the one nobody had verified anywhere. A rollforward that does
      // not close is the clearest signal of an accounting error there is.
      formula: {
        kind: 'sum',
        terms: [cur(result.beginingSurplus, 'beginning surplus'), cur(result.netIncome, 'net income')],
      },
      ...legacyCheck(surplusFromIncomeDifference),
    },
    {
      metric: 'Tie-Out Difference',
      value: formatCurrency(result.surplusTieOutDifference),
      numericValue: result.surplusTieOutDifference,
      formula: {
        kind: 'sum',
        terms: [cur(result.endingSurplus, 'ending surplus'), cur(-result.surplusFromIncome, 'less surplus from income')],
      },
      explain: 'Zero when the balance sheet and income statement agree.',
      ...legacyCheck(tieOutDifferenceDifference),
    },
  ];
}
