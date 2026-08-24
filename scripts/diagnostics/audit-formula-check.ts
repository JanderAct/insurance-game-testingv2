// DOES EVERY DISPLAYED FORMULA PRODUCE ITS OWN DISPLAYED VALUE?
//
// Run: npx tsx scripts/diagnostics/audit-formula-check.ts
//
// ============================================================================
// THE GAP THIS CLOSES. Both standing gates are VALUE-based by construction:
// value-identity compares engine fields, solo-export-guard hashes exported
// values. Neither can see a formula. A WRONG DERIVATION BESIDE A RIGHT VALUE
// is invisible to both, and that is exactly how the Calculation Audit page
// drifted through eight engine commits with nothing underneath it.
//
// evaluateFormula was exported for this and had ZERO consumers. This is the
// consumer. It would have caught, mechanically:
//   - the $0 reinsurance derivation ($8.368M value, "x 0.0% (Moderate rate)")
//   - the gross funding build-up (operands multiplying 38-73% above the value)
//   - the reserve-margin recalculation against FUNDING_CLF_TABLE[0.90]
// ============================================================================
//
// ⚠ THE TOLERANCE IS DERIVED PER ROW, NOT PICKED. Rows are built from STORED
// operands and several fields are stored rounded — activeExposure at 2dp, the
// per-$100 rates at 4dp — while the row's value is the engine's unrounded
// result. Exact reconciliation is therefore impossible by construction, and a
// flat epsilon would either miss real defects on large rows or fail correct
// ones on small rows.
//
// So each row gets a bound computed from its OWN operands by first-order
// sensitivity propagation:
//
//     bound = SUM over terms of  |d result / d term|  x  (quantum of term / 2)
//
// where the quantum is the display/storage precision of that term's format.
// A product's sensitivity to a factor is result/factor, a sum's is 1, a
// ratio's are 1/den and -num/den^2. The bound therefore scales with the row's
// own magnitude and its own operand precision, and tightens automatically as
// either improves. GATE is 3x that bound — one rounding unit can legitimately
// enter twice when the same rounded field appears in two operands.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  evaluateFormula, renderFormula, computeAuditChecks, buildSupportingRows,
  buildRevExpRows, buildNetPositionRows, buildCashInvestmentRows,
  type AuditRow, type FormulaSpec, type FormulaTerm,
} from '../../src/pages/CalculationAuditPage';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import type { CoverageLine, GameState, LineResultSet, LineView, ResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 4);
const YEARS = Number(process.env.YEARS ?? 4);
const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];
const GATE_MULTIPLE = 3;

// Display/storage quantum per term format. These are the precisions the page
// itself renders at (fmtTermValue) and, for `exposure` and `plain`, also the
// precisions the ENGINE stores at — which is the binding constraint.
const QUANTUM: Record<string, number> = {
  currency: 1,      // formatCurrency renders whole dollars
  pct: 1e-6,        // (v*100).toFixed(4) -> 1e-6 as a fraction
  factor: 1e-6,     // toFixed(6)
  exposure: 0.01,   // toFixed(2), and activeExposure is STORED at 2dp
  plain: 1e-4,      // 4dp, and the per-$100 rates are STORED at 4dp
};

function termValue(t: FormulaTerm): number {
  if ('product' in t) {
    const p = t.product.reduce((a, x) => a * termValue(x), 1);
    return t.negate ? -p : p;
  }
  return t.value;
}

// Absolute uncertainty of one term, propagated through any nesting.
function termQuantum(t: FormulaTerm): number {
  if ('product' in t) {
    // Relative errors add through a product.
    const v = Math.abs(termValue(t));
    let rel = 0;
    for (const x of t.product) {
      const xv = Math.abs(termValue(x));
      if (xv > 0) rel += termQuantum(x) / xv;
    }
    return v * rel;
  }
  return QUANTUM[t.format] ?? 0;
}

// bound = sum |d result / d term| * (quantum / 2)
function toleranceFor(spec: FormulaSpec): number {
  switch (spec.kind) {
    case 'sum':
      return spec.terms.reduce((a, t) => a + termQuantum(t) / 2, 0);
    case 'product': {
      const result = spec.factors.reduce((a, t) => a * termValue(t), 1);
      let rel = 0;
      for (const t of spec.factors) {
        const v = Math.abs(termValue(t));
        if (v > 0) rel += (termQuantum(t) / 2) / v;
      }
      return Math.abs(result) * rel;
    }
    case 'ratio': {
      const n = termValue(spec.numerator), d = termValue(spec.denominator);
      if (d === 0) return Infinity;
      const dn = termQuantum(spec.numerator) / 2;
      const dd = termQuantum(spec.denominator) / 2;
      return Math.abs(dn / d) + Math.abs((n * dd) / (d * d));
    }
    // An echo states no arithmetic of its own — it asserts equality with the
    // row's value, so any gap at all is a defect.
    case 'echo': return 0;
    default: return Infinity;
  }
}

interface Finding {
  config: string; seed: string; year: number; scope: string; section: string;
  metric: string; kind: string; evaluated: number; stated: number;
  gap: number; bound: number; ratio: number; formula: string;
  status?: string;
}

const findings: Finding[] = [];
let failures = 0;
let checked = 0;
const byKind: Record<string, number> = {};
const skipped: Record<string, number> = {};
// Per-section coverage, so "this covers the two sections nobody read" is a
// measured claim rather than an assertion.
const secChecked: Record<string, number> = {};
const secProse: Record<string, number> = {};
// Of the prose rows, how many carry NO status either — neither a machine
// checkable derivation nor an independent reconstruction. Those are the
// genuinely unguarded rows, and naming them is the point of the exercise.
const secProseUnchecked: Record<string, number> = {};

function auditRows(section: string, rows: AuditRow[], ctx: { config: string; seed: string; year: number; scope: string }) {
  for (const row of rows) {
    if (row.kind === 'section') continue;
    const spec = row.formula;
    // Prose formulas carry no arithmetic. Counted so the coverage report can
    // state what is NOT reachable rather than implying everything is.
    if (typeof spec === 'string' || spec === undefined) {
      skipped['prose'] = (skipped['prose'] ?? 0) + 1;
      secProse[section] = (secProse[section] ?? 0) + 1;
      if (!row.status) secProseUnchecked[section] = (secProseUnchecked[section] ?? 0) + 1;
      continue;
    }
    const s = spec as FormulaSpec;
    if (s.kind === 'text' || s.kind === 'simulated') {
      skipped[s.kind] = (skipped[s.kind] ?? 0) + 1;
      secProse[section] = (secProse[section] ?? 0) + 1;
      if (!row.status) secProseUnchecked[section] = (secProseUnchecked[section] ?? 0) + 1;
      continue;
    }
    if (row.numericValue === undefined) {
      skipped['no numericValue'] = (skipped['no numericValue'] ?? 0) + 1;
      secProse[section] = (secProse[section] ?? 0) + 1;
      if (!row.status) secProseUnchecked[section] = (secProseUnchecked[section] ?? 0) + 1;
      continue;
    }

    const evaluated = evaluateFormula(s);
    if (evaluated === null || !Number.isFinite(evaluated)) { skipped['non-finite'] = (skipped['non-finite'] ?? 0) + 1; continue; }

    checked++;
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    secChecked[section] = (secChecked[section] ?? 0) + 1;
    const gap = Math.abs(evaluated - row.numericValue);
    // Floor at a cent so an exact-zero bound on an all-currency sum does not
    // make float noise a failure.
    const bound = Math.max(toleranceFor(s), 0.01);
    const ratio = gap / bound;
    if (ratio > GATE_MULTIPLE) {
      findings.push({
        ...ctx, section, metric: row.metric, kind: s.kind,
        evaluated, stated: row.numericValue, gap, bound, ratio,
        formula: renderFormula(s), status: row.status,
      });
    }
  }
}

console.log('=== AUDIT PAGE FORMULA RECONCILIATION ===\n');

for (const { lines, name } of CONFIGS) {
  for (let g = 0; g < GAMES; g++) {
    const id = `AFC${name}${g}`;
    const inst = generateGameInstance(id, 1_700_000 + g * 9173);
    const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: lines };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      const poolResult = p.result as ResultSet;
      // Every scope the page can be viewed at: the pool tab and each line tab.
      const scopes: LineView[] = ['pool', ...lines];
      for (const scope of scopes) {
        const isPoolView = scope === 'pool';
        const result = isPoolView ? poolResult : poolResult.byLine[scope as CoverageLine];
        if (!result) continue;
        const ctx = { config: name, seed: id, year: y, scope: String(scope) };
        const checks = computeAuditChecks(poolResult, scope, inst.seed);

        const sup = buildSupportingRows(poolResult, scope);
        auditRows('Exposure and Membership', sup.exposureRows, ctx);
        auditRows('Funding Rate Build-Up', sup.rateRows, ctx);
        auditRows('Losses and Reinsurance', sup.lossRows, ctx);
        auditRows('Reserve Rollforward', sup.reserveRows, ctx);
        auditRows('Ratios', sup.ratioRows, ctx);
        auditRows('Capital and Reserve Confidence', sup.capitalRows, ctx);

        auditRows('Statement of Revenues, Expenses & Changes in Net Position',
          buildRevExpRows(poolResult, scope, checks), ctx);
        // ⚠ THE TWO SECTIONS NEVER READ ROW-BY-ROW, now covered by construction.
        auditRows('Statement of Net Position', buildNetPositionRows(poolResult, scope, checks), ctx);
        auditRows('Cash & Investments Rollforward', buildCashInvestmentRows(poolResult, scope, checks), ctx);

      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
}

console.log(`Evaluated ${checked.toLocaleString()} formula rows across ${CONFIGS.length} configs x ${GAMES} seeds x ${YEARS} years,`);
console.log(`at every scope the page can be viewed at (pool + each active line).\n`);
console.log('  by formula kind: ' + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('  not arithmetic (correctly unreachable): ' +
  (Object.keys(skipped).length ? Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'));

// --- COVERAGE: which sections were actually reached --------------------------
console.log('\n--- COVERAGE ---');
console.log('  Every AuditSection rendered by the page is built here, including the two');
console.log('  never audited by hand — Statement of Net Position and Cash & Investments');
console.log('  Rollforward. Nothing is sampled: all four configs, all scopes, all years.');
console.log('  What escapes is only what states no arithmetic: `text` (prose), `simulated`');
console.log('  (a draw has no closed form) and rows with no numericValue. Those are counted');
console.log('  above rather than silently dropped — a row type that stopped carrying a');
console.log('  formula would show up there as a rising count, not as a passing check.\n');
console.log('  section                                                checked   prose   of which');
console.log('                                                                             UNGUARDED');
for (const sec of [...new Set([...Object.keys(secChecked), ...Object.keys(secProse)])].sort()) {
  console.log(`    ${sec.slice(0, 50).padEnd(52)} ${String(secChecked[sec] ?? 0).padStart(6)}  ${String(secProse[sec] ?? 0).padStart(6)}  ${String(secProseUnchecked[sec] ?? 0).padStart(10)}`);
}
console.log('\n  UNGUARDED = prose derivation AND no status of its own: nothing checks it,');
console.log('  here or on the page. A prose row WITH a status is still reconstructed by the');
console.log('  page\'s own machinery; it just cannot be reached from a FormulaSpec.');
console.log('\n  ⚠ "Pool = Sum of Active Lines" shows 0 checked and that is CORRECT, not a');
console.log('  hole: its rows carry a prose build-up string, not a FormulaSpec, and every');
console.log('  one already goes through the page\'s own mkCheck (derived vs stated) which');
console.log('  IS gated. Converting them to FormulaSpec would bring them in here too.');

// --- FINDINGS ----------------------------------------------------------------
//
// ⚠ TWO BUCKETS, AND THE SPLIT IS THE POINT. A row whose own check reports
// `variance` has a DECLARED, capped, reasoned tolerance in the page itself
// (CLAIMS_VARIANCE_CAP and its stated reason) — the arithmetic is expected to
// differ and by how much is already written down. Failing those would be the
// check disagreeing with a decision already taken, not finding a defect.
//
// Everything else is a real mismatch between what a row DISPLAYS as its
// derivation and what it STATES as its value.
//
// ⚠ `na` DOES NOT SUPPRESS, deliberately. `na` means the row's own CHECK does
// not apply at this scope — it says nothing about whether the FORMULA beside
// it is right. Neutralising a check and leaving a wrong derivation on screen
// is precisely one of the defects below.
const declared = findings.filter(f => f.status === 'variance');
const defects = findings.filter(f => f.status !== 'variance');

function report(list: Finding[], heading: string) {
  if (list.length === 0) return;
  const worstByMetric = new Map<string, Finding>();
  const countByMetric = new Map<string, number>();
  for (const f of list) {
    const key = `${f.section}|${f.metric}`;
    const cur = worstByMetric.get(key);
    if (!cur || f.ratio > cur.ratio) worstByMetric.set(key, f);
    countByMetric.set(key, (countByMetric.get(key) ?? 0) + 1);
  }
  console.log(`\n${heading} — ${list.length} row-instance(s) across ${worstByMetric.size} distinct row(s):\n`);
  for (const [key, f] of [...worstByMetric.entries()].sort((a, b) => b[1].ratio - a[1].ratio)) {
    const [section, metric] = key.split('|');
    const scopes = [...new Set(list.filter(x => `${x.section}|${x.metric}` === key).map(x => x.scope))].sort();
    const configs = [...new Set(list.filter(x => `${x.section}|${x.metric}` === key).map(x => x.config))].sort();
    console.log(`  ${section}`);
    console.log(`    ${metric}   [${f.kind}]   ${countByMetric.get(key)} instance(s)`);
    console.log(`      formula evaluates to  ${f.evaluated.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
    console.log(`      row states            ${f.stated.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
    console.log(`      gap ${f.gap.toLocaleString(undefined, { maximumFractionDigits: 4 })}  vs bound ${f.bound.toLocaleString(undefined, { maximumFractionDigits: 4 })}  = ${f.ratio.toFixed(1)}x`);
    console.log(`      fails at scopes: ${scopes.join(', ')}   in configs: ${configs.join(', ')}`);
    console.log(`      worst at ${f.config} / ${f.seed} / Y${f.year} / ${f.scope}`);
    console.log(`      ${f.formula.length > 150 ? f.formula.slice(0, 150) + ' …' : f.formula}`);
    console.log('');
  }
}

// --- DOES THE SAME TECHNIQUE REACH THE EXPORT? -------------------------------
//
// Mostly no, and the reason is structural: RESULT_METRICS carries no formula
// strings — each column is a value getter, so there is no stated derivation to
// evaluate and nothing for evaluateFormula to consume.
//
// BUT THE ASSERTION STILL APPLIES WHERE ONE COLUMN IS AN EXACT FUNCTION OF
// OTHERS. Several are, and they are identities a reader would reasonably check
// by hand across the sheet. Those ARE testable, from the exported csvValues
// rather than from the engine fields, so this tests what actually ships.
//
// ⚠ ONLY NON-TAUTOLOGICAL IDENTITIES ARE LISTED. poolPremiumRateAtSelectedClf
// is literally computed as poolPremium / payroll units inside its own getter,
// so asserting it would test the compiler. Each identity below relates columns
// that are stored INDEPENDENTLY by the engine and could genuinely disagree.
// Each identity carries its OWN absolute bound, derived from the storage
// precision of the columns it relates — the same rule as the row bounds above,
// applied to the export.
const EXPORT_IDENTITIES: {
  label: string; parts: string[]; bound: number; why: string;
  check: (v: Record<string, number>) => [number, number];
}[] = [
  { label: 'purePremium = expectedCeded + netPurePremium (per $100)',
    parts: ['purePremiumRatePer100', 'expectedCededPer100', 'netPurePremiumRatePer100'],
    // purePremiumPer100 is STORED rounded to 4dp while the other two are
    // stored unrounded, so half a 4dp unit is the floor. Same bound and same
    // reason as net-funding-fields-check's section 2.
    bound: 5e-5, why: 'purePremiumPer100 is stored at 4dp; the other two are not',
    check: v => [v.expectedCededPer100 + v.netPurePremiumRatePer100, v.purePremiumRatePer100] },
  { label: 'totalMemberCharge = poolPremium + adminExpense + reinsuranceCost',
    parts: ['totalMemberCharge', 'poolPremium', 'adminExpense', 'reinsuranceCost'],
    // ⚠ THE EXPORT ROUNDS TO WHOLE DOLLARS (csvValue uses roundDollars), so
    // four rounded columns can disagree by up to half a dollar each. This is a
    // property of the EXPORT, not of the engine — and it is why the bound has
    // to be derived from the exported representation rather than from the
    // stored fields. A $0.01 bound here reported a $1.00 gap as a 100x
    // failure, which was the check being wrong, not the data.
    bound: 4 * 0.5, why: '4 columns each rounded to whole dollars in the export',
    check: v => [v.poolPremium + v.adminExpense + v.reinsuranceCost, v.totalMemberCharge] },
  { label: 'netUltimateLoss = grossUltimateLoss - reinsuranceRecovery',
    parts: ['netUltimateLoss', 'grossUltimateLoss', 'reinsuranceRecovery'],
    bound: 3 * 0.5, why: '3 columns each rounded to whole dollars in the export',
    check: v => [v.grossUltimateLoss - v.reinsuranceRecovery, v.netUltimateLoss] },
  { label: 'endingNetReserve = beginningNetReserve + netUltimate - development - netPaid',
    parts: ['endingNetReserve', 'beginningNetReserve', 'netUltimateLoss', 'priorYearDevelopment', 'netPaidLosses'],
    // The page declares a capped variance on this same identity (a closed
    // cohort's residual floored to zero). Honour that cap here rather than
    // re-litigating a decision already taken and documented.
    bound: 10_000, why: 'the page\'s own declared closed-cohort variance cap',
    check: v => [v.beginningNetReserve + v.netUltimateLoss - v.priorYearDevelopment - v.netPaidLosses, v.endingNetReserve] },
];

console.log('\n--- DOES THIS REACH THE EXPORT? ---');
console.log('  RESULT_METRICS has no formula strings, so evaluateFormula cannot be pointed at');
console.log('  it. But where one exported column is an exact function of others, the same');
console.log('  assertion applies — tested below from the exported csvValues, not the engine');
console.log('  fields, so it checks what actually ships.\n');
{
  const byKey = new Map(RESULT_METRICS.map(m => [m.key, m]));
  const worst: Record<string, number> = {};
  const missing: string[] = [];
  for (const idy of EXPORT_IDENTITIES) {
    for (const k of idy.parts) if (!byKey.has(k)) missing.push(`${idy.label}: no export column '${k}'`);
  }
  const inst = generateGameInstance('AFCEXP', 5_050_000);
  const setup = { poolName: 'E', gameLength: 4, startingYear: 2026, instanceId: 'AFCEXP', activeLines: ['WC', 'GL', 'Property'] as CoverageLine[] };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= 4; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const pool = p.result as ResultSet;
    for (const scope of ['WC', 'GL', 'Property'] as CoverageLine[]) {
      const r: LineResultSet | undefined = pool.byLine[scope];
      if (!r) continue;
      for (const idy of EXPORT_IDENTITIES) {
        if (idy.parts.some(k => !byKey.has(k))) continue;
        const v: Record<string, number> = {};
        for (const k of idy.parts) {
          const m = byKey.get(k)!;
          v[k] = Number(m.csvValue ? m.csvValue(r) : m.value(r));
        }
        const [derived, stated] = idy.check(v);
        // Measured as a MULTIPLE of the identity's own bound, so the number
        // reported is "how far past what rounding can explain".
        worst[idy.label] = Math.max(worst[idy.label] ?? 0, Math.abs(derived - stated) / idy.bound);
      }
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  for (const m of missing) console.log(`  SKIP  ${m}`);
  for (const idy of EXPORT_IDENTITIES) {
    const ratio = worst[idy.label];
    if (ratio === undefined) continue;
    const ok = ratio <= 1;
    if (!ok) failures++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${idy.label}`);
    console.log(`          worst gap ${ratio.toFixed(2)}x its bound (${idy.why})`);
  }
}

report(defects, 'DEFECTS — formula does not produce the stated value');
report(declared, 'DECLARED VARIANCE — the row documents a capped tolerance (not gated)');

if (defects.length === 0) {
  console.log('\nALL FORMULA ROWS RECONCILE within their own derived bounds.');
}

process.exitCode = (defects.length === 0 && failures === 0) ? 0 : 1;
