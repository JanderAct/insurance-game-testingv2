import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import { toHistoricalYear } from '../../src/utils/priorHistoryEngine';
import { isClaimClosed } from '../../src/utils/claimClosure';
import { closureCurveForReported } from '../../src/utils/claimTriangle';
// ============================================================================
// THE BASIS CROSS-CHECK — EVERY QUANTITY THIS TREE COMPUTES TWICE, ON ONE
// SAMPLE, SIDE BY SIDE, WITH THE BASIS NAMED.
//
//   npx tsx scripts/diagnostics/basis-cross-check.ts
//   YEARS=5 SEED=3 npx tsx scripts/diagnostics/basis-cross-check.ts
//
// ⚠ IT ASSERTS NOTHING AND IT MUST NEVER ASSERT ANYTHING. The moment this file
// grows a tolerance it becomes another gate with its own basis, which is exactly
// the failure it exists to catch. It prints. A human reads it.
//
// ============================================================================
// WHY IT EXISTS, AND THE THREE CASES THAT BUILT IT.
//
// Every gate in scripts/diagnostics/ was green through all three of these, and
// no single gate could have caught any of them, because each was TWO CORRECT
// INSTRUMENTS ANSWERING DIFFERENT QUESTIONS UNDER ONE NAME:
//
//   1. A risk-control program's benefit was reported as "the tower absorbs
//      72.8%". It absorbs 42.4%. The 72.8% came from differencing a REGISTER
//      gross against a netUltimateLoss that is an inception BOOKING — forward
//      booking contracts the occurrence before the tower sees it, so the two
//      figures are a drawn ultimate and a booked initial. Both fields are
//      correct; subtracting one from the other is not.
//   2. triangle-check's terminal spread target of 2.140 against
//      terminal-severity-check's anchor of 2.29. BOTH REPRODUCE THEIR OWN
//      TARGET on the same claims, to 0.0016 and 0.0003. They walk from
//      different starting points — one from the drawn value, one from the
//      contracted initial — so they are the drawn spread and the settled
//      spread, and only the name "TERMINAL_TARGET" is wrong.
//   3. A claims export column labelled "Drawn Occurrence" carrying the booked
//      figure.
//
// All three were found the same way: put two constructions on ONE sample and
// difference them. That is the whole mechanism here.
//
// ⚠ SAME SAMPLE IS NOT A CONVENIENCE, IT IS THE INSTRUMENT. Two gates run on
// two seed sets can differ for sampling reasons, and a real basis mismatch then
// arrives looking exactly like noise. Everything below is computed from ONE
// game, ONE year, ONE claim register. A difference here cannot be sampling.
//
// ⚠ AND IT SAYS WHAT EACH FIGURE IS ON, NOT WHICH IS RIGHT. All three cases
// above resolved to BOTH CORRECT. A cross-check that picked a winner would have
// been wrong three times out of three.
//
// ============================================================================
// WHY scripts/diagnostics/ AND A PROBES ENTRY, rather than scripts/tools/.
//
// tools/ holds things the manifest does not know about — render-identity-check
// needs a browser and a built app, the session drivers need a server. This needs
// neither; it is a plain node read of the engine, which is what everything in
// diagnostics/ is. Registering it in PROBES costs one line and buys the thing
// that matters: the manifest check fails on a file in this directory that is in
// no list, so this cannot be quietly deleted or forgotten. A cross-check that
// evaporates is the problem it was written about.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { regenerateLineYearClaims } from '../../src/utils/claimRegeneration';
import { occurrenceTotals, cedeOccurrences } from '../../src/utils/reinsuranceTower';
import { DEFAULT_LAYERS_PLACED, REINSURANCE_TOWER, TOWER_TOP } from '../../src/data/reinsuranceTower';
import { initialEstimate, cumulativeDevelopment } from '../../src/utils/claimTriangle';
import { reviseOnce, settlementFactor, type RevisionState } from '../../src/utils/claimRevision';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import { closedShare, claimClosureUnit } from '../../src/utils/claimClosure';
import { hasStaticClf, staticClf } from '../../src/data/clfTables';
import {
  FROZEN_CAPITAL_J, LINE_PAYOUT_PATTERN, resolveClosureCurve, TRIANGLE_INITIAL_CONTRACTION,
  CLAIM_SETTLED_LOG_SD_ANCHOR,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const YEARS = Number(process.env.YEARS ?? 5);
const SEED = Number(process.env.SEED ?? 1);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const M = 1e6;
const RULE = '='.repeat(100);

// ---------------------------------------------------------------- printing
/** One quantity, computed several ways. Nothing is asserted about the spread. */
interface Way { basis: string; value: number | null; note?: string }
function family(title: string, unit: string, ways: Way[], explain: string) {
  console.log(`\n--- ${title} ---`);
  const live = ways.filter(w => w.value !== null && Number.isFinite(w.value)) as { basis: string; value: number; note?: string }[];
  const width = Math.max(...ways.map(w => w.basis.length), 10);
  for (const w of ways) {
    const v = w.value === null || !Number.isFinite(w.value)
      ? '        absent'
      : (unit === '$M' ? (w.value / M).toFixed(4).padStart(14)
        : unit === '%' ? (100 * w.value).toFixed(4).padStart(14)
          : w.value.toFixed(4).padStart(14));
    console.log(`    ${w.basis.padEnd(width)}  ${v} ${unit === '%' ? '%' : unit === '$M' ? '$M' : ''}${w.note ? '   ' + w.note : ''}`);
  }
  if (live.length >= 2) {
    const lo = Math.min(...live.map(w => w.value)), hi = Math.max(...live.map(w => w.value));
    const rel = Math.abs(hi) > 1e-12 ? (hi - lo) / Math.abs(hi) : 0;
    console.log(`    ${'SPREAD'.padEnd(width)}  ${(100 * rel).toFixed(2).padStart(13)}%  `
      + `${rel < 1e-9 ? 'identical' : rel < 0.005 ? 'agree to rounding' : 'DIFFER'}`);
  }
  console.log(`    ON: ${explain}`);
}

// ---------------------------------------------------------------- the sample
const id = `BCC${SEED}`;
const inst = generateGameInstance(id, 5_050_000 + SEED * 7919);
const setup = { poolName: 'Basis', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
let gs: GameState = {
  setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
  poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
};
let last: ReturnType<typeof processYear> | null = null;
for (let y = 1; y <= YEARS; y++) {
  last = processYear(gs, defaultDecisionSet(y));
  gs = {
    ...gs, poolState: last.updatedPoolState, lockedResults: [...gs.lockedResults, last.result],
    currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
  };
}
const result = last!.result;

console.log(RULE);
console.log('BASIS CROSS-CHECK — one game, one year, every quantity computed every way');
console.log(RULE);
console.log(`instance ${id}, year ${YEARS} of ${YEARS}, lines ${LINES.join(' + ')}`);
console.log('ASSERTS NOTHING. Read the ON: line before concluding anything from a SPREAD.');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R = result as any;

for (const line of LINES) {
  const r = R.byLine?.[line];
  if (!r) continue;
  console.log(`\n${RULE}`);
  console.log(`${line}`);
  console.log(RULE);

  // ---------------------------------------------------------------- premium
  family('PREMIUM — what the pool charged', '$M', [
    { basis: 'poolPremium', value: r.poolPremium ?? null },
    { basis: 'poolPremiumAndAdminExpense', value: r.poolPremiumAndAdminExpense ?? null },
    { basis: 'totalMemberCharge', value: r.totalMemberCharge ?? null },
    { basis: 'sum(memberPremiumShares)', value: Array.isArray(r.memberPremiumShares)
      ? r.memberPremiumShares.reduce((a: number, m: { premium?: number }) => a + (m.premium ?? 0), 0) : null,
    note: 'allocated, and memberPremium.ts says it sums to poolPremium' },
  ], 'poolPremium is the retained funding pot; +admin adds the expense load; totalMemberCharge '
   + 'adds the separately stated reinsurance cost. Three different bills, not one number.');

  // ---------------------------------------------------------------- loss ratio
  family('LOSS RATIO — finding 6, corrected twice', '%', [
    { basis: 'actualLossRatio', value: r.actualLossRatio ?? null },
    { basis: 'actualLossRatioPricingBasis', value: r.actualLossRatioPricingBasis ?? null },
    { basis: 'actualLossRatioRetainedPremium', value: r.actualLossRatioRetainedPremium ?? null },
    { basis: 'expectedLossRatio', value: r.expectedLossRatio ?? null },
    { basis: 'expectedLossRatioMemberBasis', value: r.expectedLossRatioMemberBasis ?? null },
    { basis: 'netIncurred / totalMemberCharge', value: r.totalMemberCharge
      ? (r.netIncurredLoss ?? 0) / r.totalMemberCharge : null },
    { basis: 'netIncurred / poolPremium+admin', value: r.poolPremiumAndAdminExpense
      ? (r.netIncurredLoss ?? 0) / r.poolPremiumAndAdminExpense : null },
  ], 'the DENOMINATOR differs: member charge, pricing base, retained premium. The numerator differs '
   + 'too between expected and actual. Two names, five denominators.');

  // ---------------------------------------------------------------- gross loss
  const regen = (() => { try { return regenerateLineYearClaims(inst, result, line); } catch { return null; } })();
  const totals = regen ? occurrenceTotals(regen.claims, regen.occurrences) : null;
  family('GROSS LOSS — register against booking', '$M', [
    { basis: 'grossUltimateLoss (field)', value: r.grossUltimateLoss ?? null },
    { basis: 'bookedGrossUltimate (field)', value: r.bookedGrossUltimate ?? null },
    { basis: 'sum(regenerated claims)', value: totals ? totals.reduce((a, b) => a + b, 0) : null },
    { basis: 'sum(memberLossResults)', value: Array.isArray(r.memberLossResults)
      ? r.memberLossResults.reduce((a: number, m: { simulatedLoss?: number }) => a + (m.simulatedLoss ?? 0), 0) : null,
    note: 'ENROLLED members only — excludes the marketplace draw' },
    { basis: 'sum(initialEstimate(drawn))', value: totals
      ? totals.reduce((a, t) => a + initialEstimate(line, t), 0) : null,
    note: 'what the tower actually sees at inception' },
  ], 'the REGISTER is the drawn ultimate; the BOOKED figure is contracted by A x drawn^k. '
   + 'FORWARD_BOOKING is enabled, so these are different quantities and case 1 above was '
   + 'differencing across them.');

  // ---------------------------------------------------------------- ceded share
  const placed = DEFAULT_LAYERS_PLACED[line as keyof typeof DEFAULT_LAYERS_PLACED];
  const cedeDrawn = totals && placed ? cedeOccurrences(line as never, totals, placed) : null;
  const cedeBooked = totals && placed
    ? cedeOccurrences(line as never, totals.map(t => initialEstimate(line, t)), placed) : null;
  family('CEDED SHARE — the tower\'s cut', '%', [
    { basis: '1 - net/gross (fields)', value: r.grossUltimateLoss
      ? 1 - (r.netUltimateLoss ?? 0) / r.grossUltimateLoss : null, note: 'MIXES the two bases above' },
    { basis: 'cededByLayer / REGISTER', value: r.grossUltimateLoss && Array.isArray(r.cededByLayer)
      ? r.cededByLayer.reduce((a: number, b: number) => a + b, 0) / r.grossUltimateLoss : null,
    note: 'the obvious ratio, and WRONG ON BOTH COUNTS — see below' },
    { basis: 'cededByLayer / BOOKED', value: r.bookedGrossUltimate && Array.isArray(r.cededByLayer)
      ? r.cededByLayer.reduce((a: number, b: number) => a + b, 0) / r.bookedGrossUltimate : null,
    note: 'the correctly paired one' },
    { basis: 'cede(DRAWN totals)', value: cedeDrawn
      ? cedeDrawn.totalCeded / (cedeDrawn.totalCeded + cedeDrawn.retained) : null,
    note: 'the ultimate cession' },
    { basis: 'cede(BOOKED totals)', value: cedeBooked
      ? cedeBooked.totalCeded / Math.max(1, cedeBooked.totalCeded + cedeBooked.retained) : null,
    note: 'what pierces at inception' },
  ], 'a per-occurrence tower is NONLINEAR, so ceding the contracted occurrence is not ceding the '
   + 'drawn one scaled. The rest of the recovery arrives later through cedeDevelopment. '
   + 'cededByLayer is computed ON THE BOOKED OCCURRENCE, so dividing it by the REGISTER gross '
   + 'mixes the two bases and understates the cession — that row is left in deliberately, '
   + 'because it is the ratio anyone would write first.');

  // ---------------------------------------------------------------- reserve
  family('RESERVE — the same book, three questions', '$M', [
    { basis: 'endingNetReserve', value: r.endingNetReserve ?? null },
    { basis: 'expectedNetUnpaidLoss', value: r.expectedNetUnpaidLoss ?? null },
    { basis: 'indicatedNetReserveAtConfidence', value: r.indicatedNetReserveAtConfidence ?? null },
    { basis: 'netUltimateLoss - netPaidLosses', value: r.netUltimateLoss !== undefined
      ? (r.netUltimateLoss ?? 0) - (r.netPaidLosses ?? 0) : null, note: 'this accident year only' },
  ], 'the carried reserve is all accident years; expectedNetUnpaid is the expectation the margin '
   + 'is taken on; the indicated figure is CLF-loaded. Different questions about one book.');

  // ---------------------------------------------------------------- capital margin
  const clf = hasStaticClf(line) ? staticClf(line, 0.90) : null;
  family('REQUIRED CAPITAL MARGIN', '$M', [
    { basis: 'reserveRiskMarginNeeded', value: r.reserveRiskMarginNeeded ?? null },
    { basis: '(staticClf(0.90)-1) x expUnpaid', value: clf !== null && r.expectedNetUnpaidLoss !== undefined
      ? (clf - 1) * r.expectedNetUnpaidLoss : null },
    { basis: 'FROZEN_CAPITAL_J x expUnpaid', value: FROZEN_CAPITAL_J[line] !== undefined && r.expectedNetUnpaidLoss !== undefined
      ? FROZEN_CAPITAL_J[line] * r.expectedNetUnpaidLoss : null,
    note: 'the frozen literal, which only tracks the table if somebody edited it' },
    { basis: 'FROZEN_CAPITAL_J x endingNetReserve', value: FROZEN_CAPITAL_J[line] !== undefined && r.endingNetReserve !== undefined
      ? FROZEN_CAPITAL_J[line] * r.endingNetReserve : null },
  ], 'the engine reads the CLF table LIVE; the opening band reads a FROZEN literal. When a CLF '
   + 'table moves, these two diverge silently until the literal is re-edited.');

  // ---------------------------------------------------------------- claim count
  family('CLAIM COUNT', '', [
    { basis: 'claimCount (field)', value: r.claimCount ?? null },
    { basis: 'regenerated claims.length', value: regen ? regen.claims.length : null },
    { basis: 'occurrence totals length', value: totals ? totals.length : null },
    { basis: 'memberLossResults length', value: Array.isArray(r.memberLossResults) ? r.memberLossResults.length : null },
  ], 'occurrence == claim on GL and Property today; memberLossResults is one row per MEMBER, not '
   + 'per claim, so it is a different unit and is expected to differ.');

  // ---------------------------------------------------------------- pure premium
  const exposure = Array.isArray(r.memberPremiumShares)
    ? r.memberPremiumShares.reduce((a: number, m: { exposure?: number }) => a + (m.exposure ?? 0), 0)
    : Array.isArray(r.memberLossResults)
      ? r.memberLossResults.reduce((a: number, m: { exposure?: number }) => a + (m.exposure ?? 0), 0) : null;
  family('PURE PREMIUM per $100 of exposure', '', [
    { basis: 'purePremiumPer100 (PRICED)', value: r.purePremiumPer100 ?? null,
      note: 'the rate the pool CHARGES — experience path when PRICING_TRIANGLE is on, held only as fallback' },
    { basis: 'purePremium (compat alias)', value: r.purePremium ?? null },
    { basis: 'expectedLoss / exposure x100', value: exposure && r.expectedLoss
      ? 100 * r.expectedLoss / (exposure * 1e6) : null,
    note: 'REPRODUCES THE ROW ABOVE TO THE DIGIT — the identity, and the control for this family' },
    { basis: 'grossUltimate / exposure x100', value: exposure && r.grossUltimateLoss
      ? 100 * r.grossUltimateLoss / (exposure * 1e6) : null, note: 'DRAWN, one year — heavy tail' },
    { basis: 'priced x kLineApplied', value: r.purePremiumPer100 !== undefined && r.kLineApplied !== undefined
      ? r.purePremiumPer100 * r.kLineApplied : null,
    note: '⚠ NO REFERENT. Kept labelled wrong — see the note. Nothing in the engine computes this' },
    { basis: 'generator expectation / exposure x100', value: exposure && Array.isArray(r.memberLossResults)
      ? 100 * r.memberLossResults.reduce((a: number, m: { expectedLoss?: number }) => a + (m.expectedLoss ?? 0), 0) / (exposure * 1e6)
      : null, note: 'what the CLAIM GENERATOR expects, same members — a different quantity from the price' },
  ], '⚠ TWO LABELS HERE WERE WRONG AND THE CORRECTION IS THE POINT OF THE ROW ORDER. '
   + '`purePremiumPer100` was labelled "(held)". It is not the held rate: PRICING_TRIANGLE is ON, so '
   + 'the held constant is the FALLBACK and what this field carries is the rate derived from the pool\'s '
   + 'own booked triangle. And `held x kLineApplied` was offered as "the comparable figure". IT HAS NO '
   + 'REFERENT — `priced x exposure / 100` reproduces `expectedLoss` EXACTLY, so the rate as reported is '
   + 'already the pricing expectation and multiplying by k double-counts a correction the engine never '
   + 'applies. The row is KEPT and labelled wrong, beside the identity that disproves it, because it is '
   + 'the construction the author of this file wrote first and then published a 14% "gap" from. '
   + 'The generator row is a genuinely different quantity — what the CLAIM GENERATOR expects against what '
   + 'the pool CHARGES — and IS expected to differ. Nothing here says which is right, and a single year '
   + 'of a heavy tail cannot: experience-pricing-check arm 1 is where that comparison is graded, over a '
   + 'sample, against realised cost rather than against the other expectation.');

  // ---------------------------------------------------------------- surplus tie-out
  family('SURPLUS', '$M', [
    { basis: 'endingSurplus', value: r.endingSurplus ?? null },
    { basis: 'beginingSurplus + netIncome', value: r.beginingSurplus !== undefined
      ? (r.beginingSurplus ?? 0) + (r.netIncome ?? 0) : null },
    { basis: 'surplusFromIncome', value: r.surplusFromIncome ?? null },
  ], 'these SHOULD reconcile to float noise — a spread here is a real defect rather than a basis '
   + 'difference, which is what makes this family the control for the others.');
}

// ---------------------------------------------------------------- severity spread
// The case that built this file, kept as the worked example.
console.log(`\n${RULE}`);
console.log('GL SEVERITY SPREAD — the two constructions, on ONE claim register');
console.log(RULE);
{
  const regen = (() => { try { return regenerateLineYearClaims(inst, result, 'GL'); } catch { return null; } })();
  if (!regen) {
    console.log('  the GL register could not be regenerated for this year — skipped');
  } else {
    const pattern = LINE_PAYOUT_PATTERN.GL;
    const paidAt = (age: number) => Math.min(0.999, cumulativePaid(pattern, age));
    const gameId = `${id}#basis`;
    const sd = (xs: number[]) => {
      if (xs.length < 2) return NaN;
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    };
    const walk = (cid: string, start: number, ca: number) => {
      let st: RevisionState = { value: start, paidShare: 0 };
      for (let age = 1; age < ca; age++) { st = { ...st, paidShare: paidAt(age) }; st = reviseOnce(gameId, cid, age, st); }
      return st.value;
    };
    const lnD: number[] = [], lnT: number[] = [], lnR: number[] = [];
    for (const c of regen.claims) {
      const d = c.grossUltimate;
      if (!(d > 0)) continue;
      const curve = resolveClosureCurve('GL', d);
      const u = claimClosureUnit(gameId, c.id);
      let ca = 40;
      for (let t = 1; t <= 40; t++) if (closedShare(curve, t) >= u) { ca = t; break; }
      const sf = settlementFactor(gameId, c.id);
      const tsc = walk(c.id, d, ca) * sf;
      const tri = cumulativeDevelopment('GL', ca) * walk(c.id, initialEstimate('GL', d), ca) * sf;
      lnD.push(Math.log(d));
      if (tsc > 0) lnT.push(Math.log(tsc));
      if (tri > 0) lnR.push(Math.log(tri));
    }
    family('sd(ln ...) on the same claims', '', [
      { basis: 'drawn', value: sd(lnD), note: 'the severity fit\'s own, fitted at 2.14' },
      { basis: 'settled  (walk from DRAWN)', value: sd(lnT), note: `terminal-severity-check, anchor ${CLAIM_SETTLED_LOG_SD_ANCHOR}` },
      { basis: 'booked   (walk from A x d^k)', value: sd(lnR), note: 'triangle-check, target 2.140' },
    ], 'the two gates start their walk in DIFFERENT PLACES — one at the drawn value, one at the '
     + 'contracted initial — so they are the settled spread and the booked spread. Both reproduce '
     + 'their own target. Only the name TERMINAL_TARGET is wrong.');
    console.log(`    claims in this register: ${regen.claims.length}`);
    console.log('    ⚠ READ THE ORDERING, NOT THE LEVELS. One year of one game is a few hundred claims');
    console.log('      and a log-SD on a Pareto tail needs far more — on 247,191 claims these read');
    console.log('      2.1613 / 2.2897 / 2.1384. What survives at this sample is booked < drawn <');
    console.log('      settled, which is the basis difference. The LEVELS belong to the two gates.');
    console.log(`    k = ${TRIANGLE_INITIAL_CONTRACTION.GL.k}, A = ${TRIANGLE_INITIAL_CONTRACTION.GL.A}`);
  }
}

// ============================================================================
// THE DISPLAY SURFACES — WHAT A PLAYER IS SHOWN, COMPUTED EVERY WAY A SCREEN
// COMPUTES IT.
//
// ⚠ NARROW ON PURPOSE, AND THE WIDE VERSION WAS THE PROPOSAL. The original idea
// was to run every surface's pure functions on one sample and compare
// everything shared across them. By the time it came to be built, five steps of
// de-duplication had landed — cohortViews for the cohort readers, statementLines
// for the income statement, formatters for the loss-ratio bands, RESULT_METRICS
// for the spreadsheet labels and the pool-row filter — and the TYPE SPLIT
// between ResultSet and LineResultSet had turned a whole class of these into
// compile errors. A general probe over that would mostly re-derive what the
// compiler and eight gates already hold, and a probe that cannot fail is worse
// than none. So this covers the three things a survey of the tree actually
// found still computed more than once, and each one carries a CONTROL that
// fires.
//
// ⚠ IT STILL ASSERTS NOTHING, which is this file's charter and is not a
// formality here. Two of the three families below are groups of copies that are
// all CORRECT — four places computing one rate at line scope is duplication,
// not a defect — and a tolerance would turn this file into a gate with an
// opinion about which copy is canonical, which is the failure it exists to
// catch.
//
// ⚠ WHAT IT CANNOT REACH, SAID PLAINLY RATHER THAN PAPERED OVER. Three of the
// copies below live as inline expressions inside JSX and are not exported, so
// node cannot call them: ResultsPage's two per-$100 rates and its net
// prior-year development. They are NAMED with their line numbers and their
// value is recomputed here from the same fields — which means that for those
// three this file compares a TRANSCRIPTION rather than the running code, and a
// drift in the page would not show up. That is an argument for hoisting them,
// and it is recorded as a limitation instead of being hidden behind a green
// line.
// ============================================================================
console.log(`\n${RULE}`);
console.log('DISPLAY SURFACES — the three quantities still computed more than once');
console.log(RULE);

{
  const line: CoverageLine = 'GL';
  const lr = R.byLine?.[line];

  // ---- 1. THE CLOSURE BAND ------------------------------------------------
  // The one family here that WAS a defect. Three sites resolved the size band
  // and two of them disagreed; the control is the behaviour that was removed.
  {
    const regen = regenerateLineYearClaims(gs.instance, result as never, line);
    const age = 1;
    const closedOn = (curveOf: (c: { grossUltimate: number }) => ReturnType<typeof resolveClosureCurve>) =>
      regen.claims.filter(c => isClaimClosed(curveOf(c), id, c.id, age)).length;
    const asDrawn = closedOn(c => resolveClosureCurve(line, c.grossUltimate));
    const asReported = closedOn(c => closureCurveForReported(line, initialEstimate(line, c.grossUltimate)));
    const asWasBefore = closedOn(c => resolveClosureCurve(line, initialEstimate(line, c.grossUltimate)));
    family('CLOSURE BAND — how many files are closed at age 1', 'count', [
      { basis: 'register draw (memo, workbook)', value: asDrawn, note: 'resolveClosureCurve(line, Claim.grossUltimate)' },
      { basis: 'engine, reported value', value: asReported, note: 'closureCurveForReported — the shipped path' },
      { basis: 'CONTROL: reported, raw cut', value: asWasBefore, note: '⚠ the pre-fix engine path. MUST differ, or this probe is blind' },
    ], 'the size band is defined on the DRAW. The first two are the same question asked from the two '
     + 'places that ask it and must agree exactly. The third is what the engine did before the band '
     + 'was put on the draw — it resolves a contracted value against the uncontracted cut, and it is '
     + 'here so a reader can see this family is capable of showing a difference at all.');
    console.log(`    claims in this register: ${regen.claims.length}`);
  }

  // ---- 2. THE LOSS RATIO REPRODUCES FROM ITS OWN PRINTED ROWS -------------
  if (lr) {
    const byKey = (k: string) => {
      const m = RESULT_METRICS.find(x => x.key === k);
      return m?.csvValue ? Number(m.csvValue(lr)) : null;
    };
    const num = byKey('netIncurredLoss');
    const den = (byKey('poolPremium') ?? 0) + (byKey('adminExpense') ?? 0);
    family('ACTUAL LOSS RATIO — against the rows the spreadsheet prints', '%', [
      { basis: 'stored field', value: lr.actualLossRatioPricingBasis, note: 'what the page shows' },
      { basis: 'from printed rows', value: num !== null && den > 0 ? num / den : null, note: 'netIncurredLoss / (poolPremium + adminExpense), all three RESULT_METRICS rows' },
      { basis: 'CONTROL: netUltimateLoss', value: den > 0 ? (byKey('netUltimateLoss') ?? 0) / den : null, note: '⚠ the only loss row the table carried before. MUST differ' },
    ], 'a reader checking the arithmetic divides the loss row by the premium rows. That reproduced '
     + 'nothing until netIncurredLoss was added: the control is the division the table used to '
     + 'support, and it misses by tens of points because netUltimateLoss is this accident year alone '
     + 'while the ratio is on the whole ledger movement.');
  }

  // ---- 3. PRIOR-YEAR DEVELOPMENT (GROSS), TWO PLACES ----------------------
  if (lr) {
    const m = RESULT_METRICS.find(x => x.key === 'priorYearDevelopmentGross');
    family('PRIOR-YEAR DEVELOPMENT (GROSS) — derived, not stored', '$M', [
      { basis: 'RESULT_METRICS', value: m?.csvValue ? Number(m.csvValue(lr)) : null, note: "key 'priorYearDevelopmentGross', resultMetrics.ts:549" },
      { basis: 'ResultsPage:393 (transcribed)', value: lr.priorYearDevelopment - lr.priorYearDevelopmentCeded, note: '⚠ inline JSX — NOT callable, so this is a copy of the expression, not the page' },
      { basis: 'CONTROL: the stored NET', value: lr.priorYearDevelopment, note: '⚠ priorYearDevelopment itself. MUST differ whenever anything was ceded' },
    ], 'gross development is NOT a stored field — both surfaces derive it as net MINUS the ceded '
     + 'recovery, because priorYearDevelopment is favourable-positive and ceding makes an adverse '
     + 'year less adverse. Two derivations of one figure under one label. ⚠ ONLY ONE IS REACHABLE '
     + 'FROM NODE: the page copy is transcribed here, so a drift inside the page would not show. The '
     + 'control is the stored net, which is what a reader would reach for by mistake.');
  }

  // ---- 4. THE PER-$100 RATE, FOUR SITES -----------------------------------
  if (lr) {
    const m = RESULT_METRICS.find(x => x.key === 'poolPremiumRateAtSelectedClf');
    const direct = lr.poolPremium / Math.max(lr.activeExposure * 10_000, 1);
    const poolRow = R.poolPremium / Math.max(R.activeExposure * 10_000, 1);
    family('POOL PREMIUM RATE PER $100 — four sites, all line scope', 'plain', [
      { basis: 'RESULT_METRICS', value: m?.csvValue ? Number(m.csvValue(lr)) : null, note: 'resultMetrics.ts:270' },
      { basis: 'priorHistoryEngine', value: toHistoricalYear(lr).poolPremiumRatePer100 ?? null, note: 'priorHistoryEngine.ts:617, the HistoricalYear adapter' },
      { basis: 'ResultsPage:337 (transcribed)', value: direct, note: '⚠ inline JSX — NOT callable' },
      { basis: 'ResultsPage:513 (transcribed)', value: direct, note: '⚠ inline JSX — NOT callable, same expression' },
      { basis: 'CONTROL: at POOL scope', value: poolRow, note: '⚠ payroll + TIV in one denominator. MUST differ, and means nothing' },
    ], 'four copies of one formula and all four are CORRECT — this is duplication, not a defect, and '
     + 'the file says so rather than ruling on which should be canonical. The control is the pooled '
     + 'version that step 1 removed: adding payroll to TIV gives a denominator with no unit, which is '
     + 'why there is no pool rate rather than a rounding worry.');
  }
}

console.log(`\n${RULE}`);
console.log('READ THE "ON:" LINES. A SPREAD IS NOT A DEFECT UNTIL SOMEBODY SAYS THE TWO FIGURES');
console.log('WERE MEANT TO BE THE SAME QUANTITY. Nothing here is asserted.');
console.log(`GL tower: ${REINSURANCE_TOWER.GL.map(l => l.name).join(' | ')}, top $${(TOWER_TOP.GL / M).toFixed(0)}M`);
console.log(RULE);
