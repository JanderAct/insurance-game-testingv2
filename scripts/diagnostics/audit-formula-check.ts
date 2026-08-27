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
// ============================================================================
// ⚠ TWO ARMS, BECAUSE ONE ARM WAS MEASURING THE DEFAULTS AND CALLING IT THE
// PAGE. This check ran only at default decisions and reported ONE defect. The
// identical evaluation under squeezed funding reports ELEVEN. Same rows, same
// bounds, same code — the arm was the whole difference.
//
// WHY THE DEFAULT HIDES THEM, and it is not bad luck:
//
//   defaultLineDecisionSet sets fundingAtExpected on every line, which pins
//   selectedFundingCLF to exactly 1.000 EVERYWHERE. Four pool-scope rows read
//   `first.selectedFundingCLF` as a pool placeholder, and a placeholder taken
//   from one line is only right when every line agrees. At defaults they do.
//
//   The same flag makes IBNER's bookingBias exactly 0, so two reserve rows
//   that omit the (1 - bias) term are right for the same accidental reason.
//
// A row that is correct only because three lines happen to be identical is not
// a correct row; it is an untested one. The squeezed arm separates the two by
// driving each line to its OWN reachable minimum stop, which spreads the CLFs
// apart AND turns the bias on.
//
// ⚠ EACH LINE'S OWN MINIMUM, NOT A FLAT VALUE. WC's slider reaches stop 0.10
// (WC_FUNDING_CONFIDENCE_RANGE); GL and Property stop at 0.30 (SLIDER_RANGES).
// Driving all three to 0.10 would test Property at a booking bias the UI cannot
// produce, which overstates the failure and tests nothing a player can reach.
// ============================================================================
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
import { applyLoanAuthorizations, processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import {
  evaluateFormula, renderFormula, computeAuditChecks, buildSupportingRows,
  buildRevExpRows, buildNetPositionRows, buildCashInvestmentRows,
  type AuditRow, type FormulaSpec, type FormulaTerm,
} from '../../src/pages/CalculationAuditPage';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import type {
  CoverageLine, DecisionSet, GameState, LineResultSet, LineView, ResultSet,
} from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 4);
const YEARS = Number(process.env.YEARS ?? 4);
const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];
const GATE_MULTIPLE = 3;

// Each line's own reachable minimum stop — see the header on why this is not a
// flat number.
const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};

// ⚠ IS A THIRD ARM WARRANTED? YES, BUT NOT ANOTHER FUNDING ONE — MEASURED, NOT
// GUESSED. Both arms move the same slider, so both leave every other decision
// at its default. Counting observable conditions over 36 pool-years per arm:
//
//   condition                        defaults  squeezed
//   shock year                             36        36
//   adverse development                    16        33
//   loss above tower top                    4         4
//   capital thin / deficient                5         7
//   negative surplus                        1         5
//   ---- never reached by EITHER arm ----------------------------
//   dividend paid                           0         0
//   assessment levied                       0         0
//   risk-control spend                      0         0
//   aggregate stop-loss paid                0         0
//   no tower layer paid (all declined)      0         0
//   no reinsurance recovery at all          0         0
//   inter-line loan outstanding             0         0
//
// The squeeze widens the loss/capital conditions — adverse development doubles,
// negative surplus goes 1 -> 5 — but every unreached row is DECISION-gated, not
// funding-gated: dividends, assessments, risk control, the aggregate purchase
// and declining layers are all separate controls the defaults pin at zero.
//
// So the gap a third arm would close is a DECISIONS arm, and the rows it would
// reach are nameable: `Member dividends & returned premium`, `Member
// assessments` and `Loss prevention expenses` are all identically $0 in both
// arms today (a sum of zeros reconciles trivially and proves nothing), and
// Reinsurance Recovery's "+ aggregate stop-loss" and "0 layer(s) paid" text
// branches never render at all. NOT ADDED HERE: this commit is the funding
// dimension, and adding a second dimension in the same pass would make it
// impossible to say which arm found what.
interface Arm {
  name: string;
  why: string;
  decisions: (d: DecisionSet, lines: CoverageLine[]) => DecisionSet;
  /** Accept every inter-line loan offer the year produced. See the LOANS arm. */
  authorizeLoans?: boolean;
}
const ARMS: Arm[] = [
  {
    name: 'defaults',
    why: 'fundingAtExpected on every line: CLF pinned to 1.000, bookingBias 0',
    decisions: d => d,
  },
  {
    name: 'squeezed',
    why: 'every line at its own minimum stop: CLFs spread apart, bookingBias live',
    decisions: (d, lines) => ({
      ...d,
      byLine: Object.fromEntries(lines.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }],
      )) as never,
    }),
  },
  // ⚠ FUNDING IS LEFT AT ITS DEFAULT IN BOTH ARMS BELOW, DELIBERATELY. If a row
  // fails here it is the DECISION that reached it, not the squeeze — the two
  // dimensions stay separable and a finding is attributable to one of them.
  {
    name: 'decisions',
    why: 'dividends, assessments, risk control and the aggregate stop-loss all ON; funding at default',
    decisions: (d, lines) => ({
      ...d,
      riskControlPct: 0.05,
      byLine: Object.fromEntries(lines.map(l => [l, {
        ...d.byLine[l],
        dividendPct: 0.10,
        assessmentPct: 0.10,
        riskControlPct: 0.05,
        // Level 0 is the LOWEST attachment and so the one most likely to pay.
        // GL has no aggregate; normalizeAggregateStopLevel returns it to -1.
        aggregateStopLevel: 0,
      }])) as never,
    }),
  },
  // ============================================================================
  // ⚠ THE LOAN ARM, AND IT IS THE FIFTH INSTRUMENT WITH CONFIGURATION BLINDNESS —
  // the first where the blind spot was FOUND, REASONED ABOUT, AND CLOSED FOR A
  // REASON THAT TURNED OUT TO BE WRONG.
  //
  // The sweep at 9f63680 established that offers are made freely (3 at defaults,
  // up to 14 in selfInsured) and that this driver never ACCEPTS one, so
  // applyLoanAuthorizations is unreachable in every arm. The decision not to add
  // an arm rested on the audit page carrying zero loan references — true when it
  // was checked, and false as a reason, because the page reconstructs
  // endingInvestments and endingCash from flows that a loan then changes AFTER
  // the sweep. A row does not have to mention a mechanic to be broken by it.
  //
  // ⚠ THE LESSON IS NOT "ADD MORE ARMS". It is that "the display never names X"
  // does not establish "the display is independent of X". The right question is
  // whether the RECONSTRUCTION is complete, and a reconstruction written before a
  // term existed cannot be.
  //
  // ⚠ ONLY THE `tri` CONFIG CAN PRODUCE A LOAN. An inter-line loan needs another
  // line to lend, so the three solo configs run this arm as a duplicate of
  // selfInsured. That is not waste — it is the control that says the arm's
  // findings are the LOAN and not the declined tower.
  // ============================================================================
  {
    name: 'loans',
    why: 'every layer declined to force deficits, and EVERY loan offer authorized — the only arm '
      + 'in which applyLoanAuthorizations runs at all',
    authorizeLoans: true,
    decisions: (d, lines) => ({
      ...d,
      byLine: Object.fromEntries(lines.map(l => [l, {
        ...d.byLine[l],
        layersPlaced: d.byLine[l].layersPlaced.map(() => false),
        aggregateStopLevel: -1,
        // Left at its default 0.5 rather than raised: repayment has to actually
        // fire in the years AFTER origination, and the default is what a player
        // gets. Raising it would test a path the shipped default does not take.
        loanRepaymentAggressiveness: d.byLine[l].loanRepaymentAggressiveness,
      }])) as never,
    }),
  },
  {
    name: 'selfInsured',
    why: 'every occurrence layer declined: no tower, no recovery; funding at default',
    // ⚠ MUTUALLY EXCLUSIVE WITH THE ARM ABOVE, WHICH IS WHY IT IS A SECOND ARM
    // RATHER THAN MORE FLAGS ON THE FIRST. The aggregate stop-loss is CONDITIONAL
    // on a placed occurrence layer (linePricing gates quoteAggregate on
    // placedForCost), so "aggregate paid" and "all layers declined" cannot hold
    // in the same run by construction. Two arms is the minimum, not a choice.
    decisions: (d, lines) => ({
      ...d,
      byLine: Object.fromEntries(lines.map(l => [l, {
        ...d.byLine[l],
        layersPlaced: d.byLine[l].layersPlaced.map(() => false),
        aggregateStopLevel: -1,
      }])) as never,
    }),
  },
];

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
  arm: string;
  config: string; seed: string; year: number; scope: string; section: string;
  metric: string; kind: string; evaluated: number; stated: number;
  gap: number; bound: number; ratio: number; formula: string;
  status?: string;
}

const findings: Finding[] = [];
// ============================================================================
// SELF-RECORDED COVERAGE. A row whose value is identically $0 in every arm has
// not been tested — a sum of zeros reconciles trivially and proves nothing.
// `Member dividends`, `Member assessments` and `Loss prevention expenses` sat
// in exactly that state through every run of this check before the decisions
// arm existed: green, and unable to be otherwise.
//
// So each arm records which rows it made NON-ZERO. The report then names what
// each arm uniquely reaches, and — more usefully — what NO arm reaches, which
// is the honest statement of this check's remaining blind spot.
// ============================================================================
const armNonZero: Record<string, Set<string>> = {};
const allRowsSeen = new Set<string>();
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

function auditRows(section: string, rows: AuditRow[], ctx: { arm: string; config: string; seed: string; year: number; scope: string }) {
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
    const rowKey = `${section}|${row.metric}`;
    allRowsSeen.add(rowKey);
    if (Math.abs(row.numericValue) > 0) {
      (armNonZero[ctx.arm] ??= new Set()).add(rowKey);
    }
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


// ============================================================================
// CAN A READER REPRODUCE THE ROW BY HAND?
//
// Everything above works from `numericValue` and is therefore BLIND TO
// FORMATTING. A row can reconcile perfectly here and still be unusable on
// screen, because what the page PRINTS is not what it MULTIPLIED.
//
// ⚠ WORKING_PRACTICES ALREADY CARRIES THIS RULE. It was written after two
// occurrences found by hand — a rate shown at a precision too coarse to
// hand-multiply back to its own row. This is the third, the first found
// mechanically, and it is a different mechanism from the first two: not lost
// PRECISION but a lost SCALE. `exposure` terms render as `toFixed(2) + "M"`
// while evalTerm returns the bare number, so a reader who reads the M — and
// there is no reason not to — is out by a factor of 10^6.
//
// So this section re-does the arithmetic the way a reader with a calculator
// would: take each operand AS PRINTED, parse it as printed (a "%" is a
// percent, an "M" is a million), combine them as the layout shows, and compare
// against the row's PRINTED value.
//
// ⚠ IT USES THE PAGE'S OWN RENDERER, never a copy. renderFormula on a
// single-factor product returns exactly that term's rendered string, so the
// strings tested here are the strings shipped. A duplicated formatter in this
// file would drift from the page's, which is the very defect class this
// project keeps rediscovering.
//
// THE BOUND IS THE DISPLAY'S OWN ROUNDING, inferred from each printed string:
// decimals give the quantum, the suffix scales it ("21068.77M" -> 0.01 x 10^6).
// Propagated through the layout exactly as toleranceFor does, plus the printed
// result's own quantum. Anything past that is not rounding — it is a row a
// reader cannot check.
// ============================================================================

// Parse a printed operand the way a reader does. Returns null when the string
// states no number (a status word, a blank grouping header, "n/a").
function parsePrinted(raw: string): { value: number; quantum: number } | null {
  let t = raw.trim();
  // Drop a trailing "(label)" — a reader reads it as annotation, not arithmetic.
  t = t.replace(/\s*\([^()]*[A-Za-z][^()]*\)\s*$/, '').trim();
  // An echo prints "value — prose"; the number is the part before the dash.
  const dash = t.indexOf(' — ');
  if (dash > 0) t = t.slice(0, dash).trim();
  const m = t.match(/^\(?(−|-)?\$?\s*([\d,]+(?:\.(\d+))?)\s*([%MBK]?)\)?$/);
  if (!m) return null;
  let v = parseFloat(m[2].replace(/,/g, ''));
  let q = m[3] ? Math.pow(10, -m[3].length) : 1;
  const suffix = m[4];
  if (suffix === '%') { v /= 100; q /= 100; }
  else if (suffix === 'M') { v *= 1e6; q *= 1e6; }
  else if (suffix === 'B') { v *= 1e9; q *= 1e9; }
  else if (suffix === 'K') { v *= 1e3; q *= 1e3; }
  if (m[1]) v = -v;
  return { value: v, quantum: q };
}

// A term as the page prints it, via the page's own renderer.
const printTerm = (t: FormulaTerm): string => renderFormula({ kind: 'product', factors: [t] });

// Hand-evaluate a leaf or nested term from its printed form.
function handTerm(t: FormulaTerm): { value: number; quantum: number } | null {
  if ('product' in t) {
    let v = 1, rel = 0;
    for (const x of t.product) {
      const p = handTerm(x);
      if (!p) return null;
      v *= p.value;
      if (Math.abs(p.value) > 0) rel += p.quantum / Math.abs(p.value);
    }
    if (t.negate) v = -v;
    return { value: v, quantum: Math.abs(v) * rel };
  }
  return parsePrinted(printTerm(t));
}

type HandResult = { value: number; quantum: number } | null;
function handEvaluate(spec: FormulaSpec): HandResult {
  switch (spec.kind) {
    case 'product': {
      let v = 1, rel = 0;
      for (const t of spec.factors) {
        const p = handTerm(t);
        if (!p) return null;
        v *= p.value;
        if (Math.abs(p.value) > 0) rel += p.quantum / Math.abs(p.value);
      }
      return { value: v, quantum: Math.abs(v) * rel };
    }
    case 'sum': {
      let v = 0, q = 0;
      for (const t of spec.terms) {
        const p = handTerm(t);
        if (!p) return null;
        v += p.value; q += p.quantum;
      }
      return { value: v, quantum: q };
    }
    case 'ratio': {
      const n = handTerm(spec.numerator), d = handTerm(spec.denominator);
      if (!n || !d || d.value === 0) return null;
      const v = n.value / d.value;
      return { value: v, quantum: Math.abs(n.quantum / d.value) + Math.abs((n.value * d.quantum) / (d.value * d.value)) };
    }
    case 'echo': {
      const p = parsePrinted(renderFormula(spec));
      return p;
    }
    default: return null;
  }
}

// Rows a reader legitimately cannot hand-check, named with the reason rather
// than quietly dropped. Each is a DELIBERATE exclusion, not a loosened bound.
const HAND_EXCLUSIONS: { why: string; test: (row: AuditRow, spec: FormulaSpec) => boolean }[] = [
  { why: 'states no arithmetic (prose or a simulated draw)',
    test: (_r, s) => s.kind === 'text' || s.kind === 'simulated' },
  { why: 'prints no number in its Value column (grouping header, or n/a at this scope)',
    test: r => parsePrinted(r.value) === null },
];

interface HandFinding {
  arm: string; scope: string; config: string; section: string; metric: string;
  printed: string; printedValue: string; hand: number; stated: number; gap: number; bound: number; ratio: number;
}
const handFindings: HandFinding[] = [];
let handChecked = 0;
const handExcluded: Record<string, number> = {};

function handAudit(section: string, rows: AuditRow[], ctx: { arm: string; config: string; scope: string }) {
  for (const row of rows) {
    if (row.kind === 'section') continue;
    const spec: FormulaSpec = typeof row.formula === 'string' ? { kind: 'text', text: row.formula } : row.formula;
    const ex = HAND_EXCLUSIONS.find(e => e.test(row, spec));
    if (ex) { handExcluded[ex.why] = (handExcluded[ex.why] ?? 0) + 1; continue; }
    const hand = handEvaluate(spec);
    if (!hand) { handExcluded['an operand prints no parseable number'] = (handExcluded['an operand prints no parseable number'] ?? 0) + 1; continue; }
    const printedValue = parsePrinted(row.value);
    if (!printedValue) { handExcluded['prints no number in its Value column (grouping header, or n/a at this scope)'] = (handExcluded['prints no number in its Value column (grouping header, or n/a at this scope)'] ?? 0) + 1; continue; }
    handChecked++;
    const gap = Math.abs(hand.value - printedValue.value);
    const bound = Math.max(hand.quantum + printedValue.quantum, Math.abs(printedValue.value) * 1e-12, 1e-9);
    const ratio = gap / bound;
    if (ratio > GATE_MULTIPLE) {
      handFindings.push({
        ...ctx, section, metric: row.metric,
        printed: renderFormula(spec), printedValue: row.value,
        hand: hand.value, stated: printedValue.value, gap, bound, ratio,
      });
    }
  }
}


// ============================================================================
// PROSE THAT STATES A CHECKABLE FACT.
//
// ⚠ THE THIRD KIND OF CLAIM ON THIS PAGE, AND UNTIL NOW THE ONLY UNGUARDED ONE.
// A row can be wrong in three ways: its arithmetic can fail (the formula
// check), its printing can fail (the hand check), or its PROSE can assert a
// fact that is not true. The third was invisible to both: an `echo` row whose
// number is right passes everything above while the sentence beside it counts
// something else entirely.
//
// The live instance is Reinsurance Recovery. Its text reads "Per-occurrence
// tower: N layer(s) paid", where N is read off `result.cededByLayer`. At POOL
// scope that array deliberately excludes Property — its single $70M xs $5M
// layer shares no attachment with WC's and GL's $4M xs $1M, so summing them
// elementwise was meaningless and Property was removed. The COUNT was not
// updated with it, so the pooled row now undercounts: wrong in 92.5% of
// pool-years, and twice printing "0 layer(s) paid" beside a non-zero recovery.
//
// Neither arm nor either check above can see that, because the NUMBER on the
// row is correct. Only the sentence is wrong. Hence this section.
//
// EXTENSIBLE BY DESIGN: add a claim here whenever a row's prose states
// something derivable. The cost of not having it is measured above.
// ============================================================================
interface ProseClaim {
  metric: string;
  /** Pulls the asserted number out of the rendered text. */
  extract: RegExp;
  /** What the number SHOULD be, from the data the page had available. */
  truth: (poolResult: ResultSet, scope: LineView) => number;
  what: string;
}
const PROSE_CLAIMS: ProseClaim[] = [
  {
    metric: 'Reinsurance Recovery',
    extract: /Per-occurrence tower: (\d+) layer\(s\) paid/,
    what: 'occurrence layers that paid',
    // Every line's own paid-layer count, summed. At line scope this is that
    // line's own array; at pool scope it is the sum across active lines, which
    // is what "how many layers paid" means for a pool.
    truth: (poolResult, scope) => {
      const lines: CoverageLine[] = scope === 'pool'
        ? (Object.keys(poolResult.byLine) as CoverageLine[])
        : [scope as CoverageLine];
      return lines.reduce(
        (n, l) => n + ((poolResult.byLine[l]?.cededByLayer ?? []).filter(v => v > 0).length), 0);
    },
  },
  {
    metric: 'Reinsurance Cost',
    extract: /sum of (\d+) placed layer premium\(s\)/,
    what: 'occurrence layers placed',
    // ⚠ REGISTERED AFTER IT WAS CAUGHT BY HAND WHILE FIXING THE ROW ABOVE, which
    // is the argument for registering claims eagerly rather than one per
    // incident. It read cededByLayer.LENGTH — the tower's fixed WIDTH — so a
    // line with everything declined claimed "3 placed layer premium(s)" beside a
    // $0 cost, and at pool scope it read the WC+GL-only array (3) against a true
    // total width of 7. Both wrong, and neither visible to any numeric check.
    truth: (poolResult, scope) => {
      const lines: CoverageLine[] = scope === 'pool'
        ? (Object.keys(poolResult.byLine) as CoverageLine[])
        : [scope as CoverageLine];
      return lines.reduce(
        (n, l) => n + ((poolResult.byLine[l]?.decisions?.layersPlaced ?? []).filter(Boolean).length), 0);
    },
  },
];

interface ProseFinding {
  arm: string; config: string; scope: string; metric: string;
  what: string; stated: number; truth: number; text: string;
}
const proseFindings: ProseFinding[] = [];
let proseChecked = 0;
const proseNoMatch: Record<string, number> = {};

function proseAudit(rows: AuditRow[], ctx: { arm: string; config: string; scope: string },
                    poolResult: ResultSet, scope: LineView) {
  for (const row of rows) {
    const claim = PROSE_CLAIMS.find(c => c.metric === row.metric);
    if (!claim) continue;
    const spec: FormulaSpec = typeof row.formula === 'string' ? { kind: 'text', text: row.formula } : row.formula;
    const text = renderFormula(spec);
    const m = text.match(claim.extract);
    // A row whose prose does not carry the claim this year (a conditional
    // branch that did not render) is counted, not silently passed — a claim
    // that stopped appearing would show as a rising count here.
    if (!m) { proseNoMatch[claim.metric] = (proseNoMatch[claim.metric] ?? 0) + 1; continue; }
    proseChecked++;
    const stated = Number(m[1]);
    const truth = claim.truth(poolResult, scope);
    if (stated !== truth) {
      proseFindings.push({ ...ctx, metric: row.metric, what: claim.what, stated, truth, text });
    }
  }
}

let loansAuthorized = 0;
let loanDollars = 0;
let loanYears = 0;
let repaymentYears = 0;
let loanBearingScopes = 0;
const coverageFailures: string[] = [];

console.log('=== AUDIT PAGE FORMULA RECONCILIATION ===\n');

for (const arm of ARMS) {
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
      const p = processYear(gs, arm.decisions(defaultDecisionSet(y), lines));
      // ⚠ AUTHORIZE BEFORE READING ANYTHING. applyLoanAuthorizations mutates the
      // line results in place and returns a RE-AGGREGATED pool result, so the
      // page must be built from what it returns, not from what processYear did.
      // Reading p.result after authorizing would audit a pool row that no longer
      // matches its own lines.
      let poolState = p.updatedPoolState;
      let poolResult = p.result as ResultSet;
      if (arm.authorizeLoans && p.loanOffers.length > 0) {
        const applied = applyLoanAuthorizations(p, y, p.loanOffers.map(o => o.line));
        poolState = applied.updatedPoolState;
        poolResult = applied.result;
        loansAuthorized += p.loanOffers.length;
        loanDollars += p.loanOffers.reduce((a, o) => a + o.deficit, 0);
      }
      // Every scope the page can be viewed at: the pool tab and each line tab.
      const scopes: LineView[] = ['pool', ...lines];
      for (const scope of scopes) {
        const isPoolView = scope === 'pool';
        const result = isPoolView ? poolResult : poolResult.byLine[scope as CoverageLine];
        if (!result) continue;
        const ctx = { arm: arm.name, config: name, seed: id, year: y, scope: String(scope) };
        // Coverage: a loan arm that never reaches a loan-bearing scope proves
        // nothing, so the states are counted rather than assumed.
        if (result.loanOriginatedThisYear !== 0) loanYears++;
        if (result.loanRepaymentApplied !== 0) repaymentYears++;
        if (result.outstandingLoanBalance !== 0 || result.loanOriginatedThisYear !== 0
            || result.loanRepaymentApplied !== 0) loanBearingScopes++;
        const checks = computeAuditChecks(poolResult, scope, inst.seed);

        const sup = buildSupportingRows(poolResult, scope);
        auditRows('Exposure and Membership', sup.exposureRows, ctx);
        handAudit('Exposure and Membership', sup.exposureRows, ctx);
        auditRows('Funding Rate Build-Up', sup.rateRows, ctx);
        handAudit('Funding Rate Build-Up', sup.rateRows, ctx);
        auditRows('Losses and Reinsurance', sup.lossRows, ctx);
        handAudit('Losses and Reinsurance', sup.lossRows, ctx);
        proseAudit(sup.lossRows, ctx, poolResult, scope);
        auditRows('Reserve Rollforward', sup.reserveRows, ctx);
        handAudit('Reserve Rollforward', sup.reserveRows, ctx);
        auditRows('Ratios', sup.ratioRows, ctx);
        handAudit('Ratios', sup.ratioRows, ctx);
        auditRows('Capital and Reserve Confidence', sup.capitalRows, ctx);
        handAudit('Capital and Reserve Confidence', sup.capitalRows, ctx);

        const revExp = buildRevExpRows(poolResult, scope, checks);
        const netPos = buildNetPositionRows(poolResult, scope, checks);
        const cashInv = buildCashInvestmentRows(poolResult, scope, checks);
        auditRows('Statement of Revenues, Expenses & Changes in Net Position', revExp, ctx);
        // ⚠ THE TWO SECTIONS NEVER READ ROW-BY-ROW, now covered by construction.
        auditRows('Statement of Net Position', netPos, ctx);
        auditRows('Cash & Investments Rollforward', cashInv, ctx);
        handAudit('Statement of Revenues, Expenses & Changes in Net Position', revExp, ctx);
        handAudit('Statement of Net Position', netPos, ctx);
        handAudit('Cash & Investments Rollforward', cashInv, ctx);
        proseAudit(revExp, ctx, poolResult, scope);

      }
      gs = { ...gs, currentYearNumber: y + 1, poolState, lockedResults: [...gs.lockedResults, poolResult] };
    }
  }
}
}

console.log(`Evaluated ${checked.toLocaleString()} formula rows across ${ARMS.length} arms x ${CONFIGS.length} configs x ${GAMES} seeds x ${YEARS} years,`);
console.log(`at every scope the page can be viewed at (pool + each active line).\n`);
console.log('  by formula kind: ' + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`  inter-line loans: ${loansAuthorized} authorized totalling $${(loanDollars / 1e6).toFixed(2)}M; `
  + `${loanYears} scope-years with an origination, ${repaymentYears} with a repayment, `
  + `${loanBearingScopes} carrying a loan at all`);
// ⚠ AN ARM THAT STOPS REACHING ITS STATE IS WORSE THAN NO ARM, because it reads
// green while proving nothing — which is exactly how the loan went unwatched for
// as long as it did. Origination AND repayment are both required: the two passes
// touch the balance sheet at different places and only the second one runs in
// the years after a loan is taken.
if (loanYears === 0 || repaymentYears === 0) {
  coverageFailures.push(
    `THE LOAN ARM REACHED NOTHING: ${loanYears} origination(s), ${repaymentYears} repayment(s). `
    + 'The arm exists to make applyLoanAuthorizations reachable; if no offer is produced or none is '
    + 'repaid, it is measuring the selfInsured arm again and the rows it was added to guard are '
    + 'unguarded once more.');
}
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
    const mine = list.filter(x => `${x.section}|${x.metric}` === key);
    const scopes = [...new Set(mine.map(x => x.scope))].sort();
    const configs = [...new Set(mine.map(x => x.config))].sort();
    const arms = [...new Set(mine.map(x => x.arm))].sort();
    console.log(`  ${section}`);
    console.log(`    ${metric}   [${f.kind}]   ${countByMetric.get(key)} instance(s)`);
    // ⚠ AN ARM LIST OF ONLY `squeezed` IS THE INTERESTING CASE: the row is
    // correct at defaults and wrong the moment a player moves the slider, which
    // is precisely what a defaults-only run could not say.
    console.log(`      arms: ${arms.join(', ')}${arms.length === 1 && arms[0] === 'squeezed' ? '   <- invisible at defaults' : ''}`);
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
    // ⚠ THIS BOUND WAS $10,000 AND IS NOW THE ROUNDING FLOOR, BECAUSE THE
    // VARIANCE IT ALLOWED FOR NO LONGER EXISTS. It honoured the page's declared
    // closed-cohort cap: the old mechanism marked a cohort closed at
    // newUnpaid < 1000 and DROPPED it the following year, so up to $1,000 of
    // booked liability left the rollforward and the identity genuinely could
    // not close. IBNER pays that residual out instead — closing moves the
    // remainder from unpaid to paid and is ultimate-neutral — so the identity
    // is now EXACT. Measured at $0.0000 worst across 1,920 scope-years on the
    // engine fields.
    //
    // A $10,000 allowance on an identity that closes exactly would hide a
    // $9,999 defect, and this is the FOURTH tolerance in this project found
    // sitting on a provable identity after the reason for it was removed. The
    // bound is now derived exactly as its three neighbours are — five columns,
    // each rounded to whole dollars by the export — and nothing else.
    bound: 5 * 0.5, why: '5 columns each rounded to whole dollars in the export; the identity itself is exact',
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

// --- WHICH ARM SAW WHAT --------------------------------------------------
//
// The split is the finding, not bookkeeping: a row failing ONLY under squeeze
// is one a defaults-only run declared healthy.
{
  const byRow = new Map<string, Set<string>>();
  for (const f of defects) {
    const k = `${f.section}|${f.metric}`;
    if (!byRow.has(k)) byRow.set(k, new Set());
    byRow.get(k)!.add(f.arm);
  }
  const both = [...byRow.values()].filter(a => a.size === 2).length;
  const squeezeOnly = [...byRow.values()].filter(a => a.size === 1 && a.has('squeezed')).length;
  const defaultOnly = [...byRow.values()].filter(a => a.size === 1 && a.has('defaults')).length;
  console.log('\n--- ARM BREAKDOWN ---');
  for (const arm of ARMS) {
    console.log(`  ${arm.name.padEnd(10)} ${String(defects.filter(f => f.arm === arm.name).length).padStart(5)} instance(s)   (${arm.why})`);
  }
  const armsOf = (k: string) => [...byRow.get(k)!].sort().join('+');
  const tally: Record<string, number> = {};
  for (const k of byRow.keys()) tally[armsOf(k)] = (tally[armsOf(k)] ?? 0) + 1;
  console.log('\n  distinct rows by the arm combination that catches them:');
  for (const [combo, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    const only = !combo.includes('+') && combo !== 'defaults';
    console.log(`    ${combo.padEnd(34)} ${String(n).padStart(3)}${only ? `   <- invisible without the ${combo} arm` : ''}`);
  }
  void both; void squeezeOnly; void defaultOnly;
}

// --- WHAT EACH ARM UNIQUELY EXERCISES ------------------------------------
{
  console.log('\n--- COVERAGE BY ARM: which rows does each arm make non-zero? ---');
  console.log('  A row identically $0 in every arm is not passing — it is untested.\n');
  const names = ARMS.map(a => a.name);
  for (const a of names) {
    const mine = armNonZero[a] ?? new Set<string>();
    const others = new Set<string>();
    for (const b of names) if (b !== a) for (const k of (armNonZero[b] ?? new Set())) others.add(k);
    const unique = [...mine].filter(k => !others.has(k)).sort();
    console.log(`  ${a.padEnd(12)} ${String(mine.size).padStart(3)} rows non-zero, ${unique.length} of them reached by NO other arm`);
    for (const k of unique) console.log(`        ${k.split('|')[1]}`);
  }
  // ⚠ NON-ZERO IS THE WRONG METRIC FOR ONE ARM, AND SAYING SO IS THE POINT.
  // selfInsured's whole contribution is driving rows TO zero — no tower, no
  // recovery, no ceded layers — so it can never show up as "uniquely non-zero".
  // The branch it reaches is the empty one, which is exactly where Reinsurance
  // Recovery's "0 layer(s) paid" text lives. Reported separately rather than
  // left looking like an arm that earns nothing.
  for (const a of names) {
    const mine = armNonZero[a] ?? new Set<string>();
    const zeroedHere = [...allRowsSeen].filter(k =>
      !mine.has(k) && names.some(b => b !== a && (armNonZero[b] ?? new Set()).has(k)));
    if (zeroedHere.length) {
      console.log(`\n  ${a} additionally drives ${zeroedHere.length} row(s) to ZERO that another arm makes non-zero`);
      console.log('  (the empty branch — a distinct code path, not an absence of coverage):');
      for (const k of zeroedHere.sort()) console.log(`        ${k.split('|')[1]}`);
    }
  }
  const covered = new Set<string>();
  for (const a of names) for (const k of (armNonZero[a] ?? new Set())) covered.add(k);
  const never = [...allRowsSeen].filter(k => !covered.has(k)).sort();
  // ⚠ ZERO MEANS TWO DIFFERENT THINGS AND THE LIST MUST NOT CONFLATE THEM. On a
  // "Check Difference" row zero is the PASS state — the reconciliation held — so
  // an always-zero one is either a permanently satisfied identity or a check
  // that cannot fire, and only reading it tells you which. On a value row,
  // always-zero means the row was never exercised at all.
  const [alwaysZeroChecks, alwaysZeroValues] = [
    never.filter(k => /Check Difference|Check$/.test(k.split('|')[1])),
    never.filter(k => !/Check Difference|Check$/.test(k.split('|')[1])),
  ];
  console.log(`\n  rows identically ZERO in ALL ${names.length} arms: ${never.length}`);
  if (alwaysZeroValues.length) {
    console.log(`    VALUE rows — genuinely unexercised, nothing here is tested: ${alwaysZeroValues.length}`);
    for (const k of alwaysZeroValues) console.log(`        ${k.split('|')[0]} / ${k.split('|')[1]}`);
  } else {
    console.log('    VALUE rows — genuinely unexercised: 0   (every value row is non-zero in some arm)');
  }
  if (alwaysZeroChecks.length) {
    console.log(`    CHECK rows — zero is their PASS state, so this is a satisfied identity`);
    console.log(`    rather than a hole; worth reading once to confirm it CAN fire: ${alwaysZeroChecks.length}`);
    for (const k of alwaysZeroChecks) console.log(`        ${k.split('|')[0]} / ${k.split('|')[1]}`);
  }
}

// --- HAND-MULTIPLICATION -------------------------------------------------
console.log('\n--- CAN A READER REPRODUCE THE ROW BY HAND? ---');
console.log('  The operands AS PRINTED, combined as the layout shows, against the value AS');
console.log('  PRINTED. Bound is the printed strings\' own rounding and nothing else.\n');
console.log(`  ${handChecked.toLocaleString()} row-instances hand-evaluated.`);
console.log('  excluded, with reason (a deliberate exclusion, never a loosened bound):');
for (const [why, n] of Object.entries(handExcluded).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(6)}  ${why}`);
}
if (handFindings.length === 0) {
  console.log('\n  OK — every hand-checkable row reproduces from its printed operands.');
} else {
  const worst = new Map<string, HandFinding>();
  const count = new Map<string, number>();
  for (const f of handFindings) {
    const k = `${f.section}|${f.metric}`;
    const cur = worst.get(k);
    if (!cur || f.ratio > cur.ratio) worst.set(k, f);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  // ⚠ THE TWO CHECKS OVERLAP, AND THE NON-OVERLAP IS THE POINT. A row whose
  // FORMULA is wrong also fails here, because a wrong formula printed is still
  // a formula a reader cannot reproduce. Rows failing HERE ONLY are the
  // purely-presentational ones — the arithmetic is right and the printing is
  // not — and they are the set the formula check can never reach.
  const defectRows = new Set(defects.map(f => `${f.section}|${f.metric}`));
  const formattingOnly = [...worst.keys()].filter(k => !defectRows.has(k));
  console.log(`\n  NOT HAND-REPRODUCIBLE — ${handFindings.length} row-instance(s) across ${worst.size} distinct row(s),`);
  console.log(`  of which ${formattingOnly.length} fail ONLY here — arithmetic correct, printing not:`);
  for (const k of formattingOnly) console.log(`      ${k.split('|')[1]}`);
  console.log('');
  for (const [k, f] of [...worst.entries()].sort((a, b) => b[1].ratio - a[1].ratio)) {
    const [section, metric] = k.split('|');
    const scopes = [...new Set(handFindings.filter(x => `${x.section}|${x.metric}` === k).map(x => x.scope))].sort();
    console.log(`  ${section}`);
    console.log(`    ${metric}   ${count.get(k)} instance(s)   scopes: ${scopes.join(', ')}`);
    console.log(`      printed:      ${f.printed.length > 130 ? f.printed.slice(0, 130) + ' …' : f.printed}`);
    console.log(`      hand gives:   ${f.hand.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
    console.log(`      row prints:   ${f.printedValue}`);
    console.log(`      off by ${f.ratio > 1e6 ? f.ratio.toExponential(2) : f.ratio.toFixed(1)}x the printed rounding\n`);
  }
}

// --- PROSE CLAIMS ---------------------------------------------------------
console.log('\n--- DOES THE PROSE STATE A TRUE FACT? ---');
console.log('  A row whose NUMBER is right can still carry a sentence that is not. Neither');
console.log('  check above can see that; this one can, for claims that are derivable.\n');
console.log(`  ${proseChecked.toLocaleString()} prose claim(s) evaluated across ${PROSE_CLAIMS.length} registered claim(s).`);
for (const [metric, n] of Object.entries(proseNoMatch)) {
  console.log(`    ${String(n).padStart(6)}  ${metric}: the claim's branch did not render this time (counted, not passed)`);
}
if (proseFindings.length === 0) {
  console.log('\n  OK — every registered prose claim matches the data.');
} else {
  const worst = new Map<string, { f: ProseFinding; n: number; scopes: Set<string>; arms: Set<string>; zeroBesidePaid: number }>();
  for (const f of proseFindings) {
    const e = worst.get(f.metric) ?? { f, n: 0, scopes: new Set<string>(), arms: new Set<string>(), zeroBesidePaid: 0 };
    e.n++; e.scopes.add(f.scope); e.arms.add(f.arm);
    if (f.stated === 0 && f.truth > 0) e.zeroBesidePaid++;
    if (Math.abs(f.stated - f.truth) > Math.abs(e.f.stated - e.f.truth)) e.f = f;
    worst.set(f.metric, e);
  }
  console.log(`\n  FALSE PROSE — ${proseFindings.length} instance(s) across ${worst.size} distinct row(s):\n`);
  for (const [metric, e] of worst) {
    console.log(`    ${metric}   ${e.n} of ${proseChecked} claim(s) wrong (${(100 * e.n / proseChecked).toFixed(1)}%)`);
    console.log(`      scopes: ${[...e.scopes].sort().join(', ')}   arms: ${[...e.arms].sort().join(', ')}`);
    console.log(`      worst: states ${e.f.stated} ${e.f.what}, data supports ${e.f.truth}`);
    if (e.zeroBesidePaid) {
      console.log(`      ⚠ ${e.zeroBesidePaid} instance(s) state ZERO beside a non-zero recovery — a self-contradiction on one row`);
    }
    console.log('');
  }
}

for (const c of coverageFailures) console.log(`\n⚠ COVERAGE FAILURE: ${c}`);

if (coverageFailures.length === 0
    && defects.length === 0 && handFindings.length === 0 && proseFindings.length === 0 && failures === 0) {
  console.log('\nALL FORMULA ROWS RECONCILE within their own derived bounds, in every arm;');
  console.log('every hand-checkable row reproduces from its printed operands; and every');
  console.log('registered prose claim matches the data.');
}

process.exitCode =
  (coverageFailures.length === 0
    && defects.length === 0 && handFindings.length === 0 && proseFindings.length === 0 && failures === 0) ? 0 : 1;
