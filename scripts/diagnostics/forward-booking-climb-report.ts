// THE CLIMB, MEASURED WITHOUT REQUIRING COMPLETION — the acceptance instrument
// for every forward-booking attempt. A READING, not a gate: it has no threshold
// because the mechanism it measures is not built yet.
//
// ============================================================================
// ⚠ WHY THE OLD INSTRUMENT COULD NOT RESOLVE, AND WHY THAT MATTERED.
//
// The completion test — every tracked occurrence closed AND the untracked open
// share at zero — is correct and strict, and that is the problem. WC's cohorts
// develop to age 12 and its claims close later still, so only THREE WC accident
// years finished in 12 games x 20 years. Every climb figure in commits 1 and 1a
// rested on it, and a 3-observation reading cannot separate 0.68 from 1.00.
//
// ⚠ AND IT WAS NOT ONLY UNDER-POWERED, IT WAS SELECTED. The cohorts that finish
// inside a run are the ones whose claims closed FASTEST, which is exactly the
// property the climb depends on. So the finished subset is biased, not merely
// small — measured below, the two statistics agree on the SAME cohorts to within
// 0.7-2.7% but disagree by up to 13 points across their different populations.
// Loosening the completion test would have made that worse rather than better.
//
// ============================================================================
// THE STATISTIC. A cohort at age a has climbed ultimate(a)/ultimate(0). Against
// it, T(a) — the development that cohort SHOULD have received by age a, being
// the value-weighted mean over its own claims of the generator's cumulative
// drift to min(closure age, a+1). Both are ratios to the same opening, so
//
//     R(cohort, a) = [ultimate(a) / ultimate(0)] / T(a)
//
// is 1.000 when the engine develops at the right rate, AT EVERY AGE, and it uses
// every accident year rather than only the finished ones. T at full maturity is
// 1/c by construction, so R at completion IS the old statistic — which is the
// agreement check rather than an assumption.
//
// ⚠ THE BOOTSTRAP RESAMPLES GAMES, NOT ROWS. A cohort appears at ages 1..20 and
// those rows are the same cohort; cohorts within a game share a draw. Treating
// 18,790 rows as 18,790 observations would understate the interval by roughly
// 20x. Games are the independent unit and are what is resampled.
//
// ⚠ SIZING, MEASURED RATHER THAN CARRIED. Per-game sd of R and the games needed
// for a stated interval are printed every run, because a required-sample figure
// is itself unstable at small n — GL's read 3,623 at 200 games and 1,458 at
// 6,000 on the M2 work, and that lesson is in WORKING_PRACTICES.
//
// SO IT WAS CHECKED AGAINST ITSELF ACROSS A 5x SAMPLE CHANGE, and here it holds:
//
//     games needed for +/-0.02      at 24 games      at 120 games
//     WC                                     7                13
//     GL                                   112                98
//     Property                              22                17
//
// Same order on every line, unlike the M2 case. GAMES defaults to 120 because
// that is what clears GL's 98, and because 24 was NOT enough: GL read
// 1.0245 [0.9830, 1.0697] at 24 with 1.000 inside, and 1.0192 [1.0033, 1.0386]
// at 120 with 1.000 OUTSIDE. The 24-game run would have reported GL as
// developing correctly. Do not lower this default to save a run.
//
// ⚠ AND PAIRING BUYS ALMOST NOTHING HERE, WHICH IS THE OPPOSITE OF M2 AND
// CESSION. Variant A minus variant B on shared seeds resolved at ~5x less
// sample there; measured on this statistic it is 1.5x / 1.2x / 1.0x. The climb
// is dominated by within-game claim draws rather than by the instance, so the
// seed does not cancel. Size the levels, not the differences.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { initialEstimate, cumulativeDevelopment } from '../../src/utils/claimTriangle';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { closedShare, claimClosureUnit } from '../../src/utils/claimClosure';
import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import { FORWARD_BOOKING, resolveClosureCurve } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(72);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 120);
const YEARS = Number(process.env.YEARS ?? 20);
const MAXA = 24;
/** The untracked mass counts as run off below this share still open. */
const OPEN_EPS = 0.02;
const members = getPredefinedMarketMembers();

/** T(a) — the development a cohort of this line should have received by age a. */
function targetCurve(line: CoverageLine): number[] {
  const rows: { w: number; ca: number }[] = [];
  for (let y = 1; y <= 25; y++) {
    const gameId = `TC${line}${y}`;
    const base = { members, yearNumber: 1, calendarYear: 2026, instanceSeed: 6_100_000 + y * 7919, riskControlEffectiveness: 0 };
    const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
      : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
        : generatePropertyClaims({ ...base, kPr: 1 });
    for (const c of r.claims) {
      const curve = resolveClosureCurve(line, c.grossUltimate);
      const u = claimClosureUnit(gameId, c.id);
      let ca = 40;
      for (let k = 1; k <= 40; k++) if (closedShare(curve, k) >= u) { ca = k; break; }
      rows.push({ w: initialEstimate(line, c.grossUltimate), ca });
    }
  }
  const W = rows.reduce((s, r) => s + r.w, 0);
  const T: number[] = [];
  for (let a = 0; a <= MAXA; a++) {
    T.push(rows.reduce((s, r) => s + r.w * cumulativeDevelopment(line, Math.min(r.ca, a + 1)), 0) / W);
  }
  return T;
}

type Coh = {
  yearNumber: number; netUltimate: number; age: number;
  developingClaims?: { closed?: boolean }[];
};
const finished = (line: CoverageLine, c: Coh) => {
  const tr = c.developingClaims ?? [];
  return (tr.length === 0 || tr.every(d => d.closed === true))
    && 1 - closedShare(resolveClosureCurve(line, 0), c.age + 2) <= OPEN_EPS;
};

const T: Record<string, number[]> = {};
for (const l of LINES) T[l] = targetCurve(l);

interface Row { line: number; game: number; age: number; R: number; fin: boolean; climb: number }
const rows: Row[] = [];

// ⚠ ASSERTS THE FLAGGED ARM. FORWARD_BOOKING ships off; this is a reading of the
// mechanism under construction, restored in a finally.
const wasEnabled = FORWARD_BOOKING.enabled;
FORWARD_BOOKING.enabled = true;
try {
  for (let g = 0; g < GAMES; g++) {
    const id = `FC${g}`;
    const instance = generateGameInstance(id, 5_200_000 + g * 7919);
    const setup = { poolName: 'F', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    let st = poolState;
    const open: Record<string, Map<number, number>> = { WC: new Map(), GL: new Map(), Property: new Map() };
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      st = p.updatedPoolState;
      const S = st as never as { lines: Record<string, { reserveCohorts: Coh[] }> };
      for (const l of LINES) {
        for (const c of S.lines[l]?.reserveCohorts ?? []) {
          if (c.age === 0 && !open[l].has(c.yearNumber)) open[l].set(c.yearNumber, c.netUltimate);
          const o = open[l].get(c.yearNumber);
          if (!o || o <= 0 || c.age < 1 || c.age > MAXA) continue;
          const t = T[l][c.age];
          if (!(t > 0)) continue;
          rows.push({
            line: LINES.indexOf(l), game: g, age: c.age,
            R: (c.netUltimate / o) / t, fin: finished(l, c), climb: c.netUltimate / o,
          });
        }
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: st, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
} finally { FORWARD_BOOKING.enabled = wasEnabled; }
if (FORWARD_BOOKING.enabled !== wasEnabled) {
  console.log('⚠ FORWARD_BOOKING WAS NOT RESTORED');
  process.exitCode = 1;
}

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1));
};
let seed = 20260905;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
function gameClusteredCI(byGame: Map<number, number[]>): [number, number] {
  const keys = [...byGame.keys()];
  const out: number[] = [];
  for (let b = 0; b < 3000; b++) {
    const flat: number[] = [];
    for (let i = 0; i < keys.length; i++) flat.push(...byGame.get(keys[Math.floor(rnd() * keys.length)])!);
    out.push(mean(flat));
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * out.length)], out[Math.floor(0.975 * out.length)]];
}

console.log(RULE);
console.log('FORWARD BOOKING — THE CLIMB, ON THE PARTIAL-MATURITY INSTRUMENT');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years, flagged arm. R = 1.000 is the target at every age.\n`);

console.log('--- AGREEMENT: the two statistics on the SAME cohorts ---');
console.log('  line      finished rows   mean R   mean climb/T(max)   ratio');
for (let li = 0; li < LINES.length; li++) {
  const fin = rows.filter(r => r.line === li && r.fin);
  if (fin.length === 0) { console.log(`  ${LINES[li].padEnd(9)} ${String(0).padStart(13)}   (none finished)`); continue; }
  const Tmax = T[LINES[li]][MAXA];
  const a = mean(fin.map(r => r.R)), b = mean(fin.map(r => r.climb / Tmax));
  console.log(`  ${LINES[li].padEnd(9)} ${String(fin.length).padStart(13)}   ${a.toFixed(4)}   ${b.toFixed(4).padStart(17)}   ${(a / b).toFixed(4)}`);
}

console.log('\n--- THE CLIMB, GAME-CLUSTERED ---');
console.log('  line      rows   games   mean R   95% CI              1.000 in   per-game sd   games @ +/-0.05  @ +/-0.02');
for (let li = 0; li < LINES.length; li++) {
  const rs = rows.filter(r => r.line === li);
  if (rs.length === 0) continue;
  const byGame = new Map<number, number[]>();
  for (const r of rs) { if (!byGame.has(r.game)) byGame.set(r.game, []); byGame.get(r.game)!.push(r.R); }
  const [lo, hi] = gameClusteredCI(byGame);
  const perGame = [...byGame.values()].map(mean);
  const s = sd(perGame);
  const n = (w: number) => Math.ceil((1.96 * s / w) ** 2);
  console.log(`  ${LINES[li].padEnd(9)} ${String(rs.length).padStart(5)}   ${String(byGame.size).padStart(5)}   `
    + `${mean(rs.map(r => r.R)).toFixed(4)}   [${lo.toFixed(4)}, ${hi.toFixed(4)}]   ${(lo <= 1 && 1 <= hi ? 'YES' : 'no ').padStart(8)}   `
    + `${s.toFixed(4).padStart(11)}   ${String(n(0.05)).padStart(15)}  ${String(n(0.02)).padStart(9)}`);
}

console.log('\n--- R BY AGE, so an age-dependent error is visible rather than averaged ---');
console.log('  line      ' + [1, 2, 3, 4, 6, 8, 10, 12].map(a => `age${String(a).padStart(2)}`).join('  '));
for (let li = 0; li < LINES.length; li++) {
  const cells = [1, 2, 3, 4, 6, 8, 10, 12].map(a => {
    const v = rows.filter(r => r.line === li && r.age === a).map(r => r.R);
    return (v.length ? mean(v).toFixed(3) : '  -  ').padStart(5);
  });
  console.log(`  ${LINES[li].padEnd(9)} ` + cells.join('  '));
}
console.log('');
console.log(RULE);
console.log('A READING. No threshold: the mechanism this measures is not built, and a');
console.log('tolerance would be a target rather than a check.');
console.log(RULE);
