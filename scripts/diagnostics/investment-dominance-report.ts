// ============================================================================
// IS INVESTMENT INCOME CARRYING THE RESULT? A DESIGN READING, NOT A GATE.
//
// Run:  npx tsx scripts/diagnostics/investment-dominance-report.ts
//       GAMES=40 CLF=0.45 npx tsx scripts/diagnostics/investment-dominance-report.ts
//
// ⚠ THIS ASSERTS NOTHING AND IS IN PROBES DELIBERATELY. There is no threshold
// here that would not be invented. The question is whether the FUNDING DECISION
// still has the consequence the game intends, and that is a design judgement the
// numbers inform rather than settle.
//
// THE OBSERVATION IT COMES FROM. One playtest seed, funded at about 45% on all
// three lines:
//
//   WC        underwriting  -0.3M   investment  +9.4M   net  +10.9M
//   GL        underwriting  +7.3M   investment +10.8M   net  +20.7M
//   Property  underwriting -17.3M   investment  +7.8M   net   -2.3M
//
// Property lost $17.3M underwriting and its surplus fell only $2.3M. If that is
// typical, a player can underprice by ten points and still grow surplus because
// the float pays for it — and the funding slider, which is the game's only
// pricing lever, stops carrying the lesson it exists to teach.
//
// ⚠ AND THERE IS A REASON TO EXPECT IT TO HAVE GOT WORSE RECENTLY. The payout
// patterns roughly doubled the reserve, and the reserve IS the invested base.
// Nobody has measured what that did to the balance between underwriting and
// investment, so this measures it rather than assuming the old intuition holds.
//
// WHAT IT REPORTS, per line, across seeds:
//   - underwriting income and investment income, and the ratio between them
//   - how often investment income alone flips a losing underwriting year into a
//     rising surplus — the specific failure mode described above
//   - the IMPLIED RETURN on invested assets, so a reader can see whether the
//     dominance is coming from a high return or simply from a large float
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 30);
const YEARS = Number(process.env.YEARS ?? 5);
/** Funding confidence to run at. Empty = defaults (fund at expected). */
const CLF = process.env.CLF ? Number(process.env.CLF) : null;

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};

function decisions(y: number): DecisionSet {
  const d = defaultDecisionSet(y);
  if (CLF === null) return d;
  return {
    ...d,
    byLine: Object.fromEntries(LINES.map(l => [l, {
      ...d.byLine[l],
      fundingConfidenceLevel: Math.max(MIN_STOP[l], CLF),
      fundingAtExpected: false,
    }])) as never,
  };
}

interface Obs { uw: number; inv: number; surplusChange: number; invested: number }
const obs: Record<string, Obs[]> = { WC: [], GL: [], Property: [] };

for (let g = 0; g < GAMES; g++) {
  const id = `INV${g}`;
  const inst = generateGameInstance(id, 2_600_000 + g * 4691);
  const setup = { poolName: 'I', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, decisions(y));
    for (const l of LINES) {
      const lr = p.result.byLine[l];
      obs[l].push({
        uw: lr.underwritingIncome,
        inv: lr.investmentIncome,
        surplusChange: lr.endingSurplus - lr.beginingSurplus,
        // The base the return is earned on. Read from the line's own portfolio
        // at the START of the year, which is what was invested through it.
        invested: (gs.poolState.lines[l] as never as { investedAssets?: number }).investedAssets ?? 0,
      });
    }
    gs = {
      ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
      currentYearNumber: y + 1,
    };
  }
}

const q = (a: number[], p: number) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const M = (n: number) => `${n >= 0 ? '+' : '-'}${(Math.abs(n) / 1e6).toFixed(1)}M`;

console.log('=== INVESTMENT vs UNDERWRITING — a design reading, no thresholds ===');
console.log(`${GAMES} games x ${YEARS} years, funding ${CLF === null ? 'at DEFAULTS (expected)' : `at CLF ${CLF}`}.\n`);

console.log('  line       underwriting income          investment income        inv / |uw|');
console.log('             p10      med      p90        p10      med      p90      median');
for (const l of LINES) {
  const o = obs[l];
  const uw = o.map(x => x.uw), inv = o.map(x => x.inv);
  const ratio = o.filter(x => Math.abs(x.uw) > 1).map(x => x.inv / Math.abs(x.uw));
  console.log(`  ${l.padEnd(9)} ${M(q(uw, .1)).padStart(7)} ${M(q(uw, .5)).padStart(8)} ${M(q(uw, .9)).padStart(8)}`
    + `   ${M(q(inv, .1)).padStart(8)} ${M(q(inv, .5)).padStart(8)} ${M(q(inv, .9)).padStart(8)}`
    + `   ${q(ratio, .5).toFixed(2)}x`);
}

console.log('\n  THE FAILURE MODE, COUNTED: a line-year that LOST money underwriting and still');
console.log('  grew surplus. That is the float paying for the underpricing.');
console.log('  line       uw-negative years    of those, surplus still rose      share');
for (const l of LINES) {
  const neg = obs[l].filter(x => x.uw < 0);
  const rescued = neg.filter(x => x.surplusChange > 0);
  console.log(`  ${l.padEnd(9)} ${String(neg.length).padStart(12)}${String(rescued.length).padStart(26)}`
    + `${neg.length > 0 ? `${((100 * rescued.length) / neg.length).toFixed(0)}%` : '   -'.padStart(11)}`.padStart(15));
}

console.log('\n  IMPLIED RETURN ON INVESTED ASSETS — is the dominance a high return, or a');
console.log('  large float? A modest return on a doubled reserve looks the same on the');
console.log('  income statement and means something quite different for the design.');
console.log('  line       invested assets (median)    implied return (median)');
for (const l of LINES) {
  const o = obs[l].filter(x => x.invested > 0);
  const ret = o.map(x => x.inv / x.invested);
  console.log(`  ${l.padEnd(9)} ${(q(o.map(x => x.invested), .5) / 1e6).toFixed(1).padStart(15)}M`
    + `${(100 * q(ret, .5)).toFixed(2).padStart(23)}%`);
}

console.log('\n  READ THIS AS A DESIGN FINDING, NOT A DEFECT. Nothing here is miscalculated.');
console.log('  The question it raises is whether the funding slider still carries the');
console.log('  consequence the game intends, and that is a ruling rather than a fix.');
