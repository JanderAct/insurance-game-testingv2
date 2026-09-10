// ============================================================================
// THE MATURITY ANCHOR — DOES A COHORT DEVELOP BACK TO ITS OWN REGISTER? A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/maturity-anchor-check.ts
//   GAMES=40 npx tsx scripts/diagnostics/maturity-anchor-check.ts
//
// Forward booking's whole premise is one sentence: book the cohort at the
// CONTRACTED estimate of its claims, then develop it back up to what those
// claims were actually drawn at. The contraction is c; the climb must therefore
// be 1/c. Nothing asserted that, and a 28% overshoot on GL and 36% on Property
// lived in the flagged arm for three commits without a gate noticing.
//
// ⚠ WHY IT WAS INVISIBLE. types/simulation.ts states the identity
//
//     netUltimate + cededDevelopmentToDate === registerSum   (at maturity)
//
// as standing. It is asserted NOWHERE — cohort-ledger-check names registerSum
// only inside detail strings. And terminal-severity-check, the gate that sounds
// like it would catch this, runs the claim generator and the revision law and
// NOTHING ELSE: no engine, no cohort horizon, no tower. It also anchors a
// log-SD, which is a SPREAD. This is a LEVEL. It was silent by construction and
// remains so; that is its own gap and not this gate's to close.
//
// ============================================================================
// ⚠ TWO BASIS TRAPS ARE BUILT INTO THIS FILE BECAUSE BOTH WERE WALKED INTO.
//
// 1. THE THIRD-BASIS TRAP. 1/c is an AGGREGATE, VALUE-WEIGHTED ratio:
//    sum(drawn) / sum(initialEstimate(drawn)) over the claim population. Two
//    other statistics look like it and are not:
//      - the COUNT-weighted mean of per-claim ratios, which on GL's alpha-1.3
//        tail reads 1.5153 against a value-weighted 3.4972 — a factor of 2.3;
//      - the HORIZON-AVERAGED DRIFT SCHEDULE, mean over h of cum(h), which is
//        a property of the schedule and not a realised climb at all. A reading
//        of 2.50 / 4.59 / 1.67 was quoted against 1/c from that basis and was
//        not comparable to it.
//    Both sides here are recomputed as one statistic: value-weighted sums.
//
// 2. THE MATURITY BIAS. A cohort written late in a game cannot reach a long
//    horizon before the game ends, so an unfiltered sample is biased toward
//    SHORT horizons — which drift less and understate the gap. Correcting for
//    it moved WC from +1.6% to +4.8% and GL from +20.4% to +28.1%. Only
//    accident years with room for the LONGEST horizon in their line are counted.
//
// ============================================================================
// ⚠ AND THE NET SIDE IS A READING, NOT AN ASSERTION, FOR A REASON WORTH
// KEEPING. Measured before the fix: GL's gross overshoot of +28.1% met a tower
// taking 1.91x the opening and landed at -0.3% NET. Property's tower takes
// 0.31x and its +36.5% gross landed at +21.1% net. Nothing links the cession
// share to the drift schedule — the absorption is arithmetic coincidence, and
// asserting on net would be asserting on the reinsurance programme. The gross
// leg is the one the mechanism controls, so the gross leg is the one gated.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { initialEstimate } from '../../src/utils/claimTriangle';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import { FORWARD_BOOKING, IBNER_HORIZON } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(76);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// ⚠ 16 -> 48, AND THE REASON IS IBNER_CALENDAR_RHO RATHER THAN ANYTHING WRONG
// WITH THIS GATE. Its statistic is an aggregate over COHORTS, and its power
// came from those cohorts being independent draws. The calendar blend makes
// every cohort of a line share one shock per valuation, so the independent unit
// becomes the (game, line-year) and the effective sample collapses by roughly
// the number of open accident years — most of an order of magnitude on
// Property, which carries only three or four.
//
// MEASURED at the shipped cell, Property's gross gap against 1/c:
//   16 games  +9.9%      32 games  +5.9%      48 games  +4.4%      64 games  +4.3%
// against a MAX_GAP of 10%. The +9.9% is not a real overshoot — it converges to
// +4.3% — but at the old default this gate sat one seed set away from red for a
// reason unconnected to the quantity it asserts. The null arm reads +2.4% at 48,
// so the blend roughly doubles this estimator's spread and does not bias it.
//
// ⚠ DO NOT PUT THIS BACK TO 16 TO SAVE THE RUNTIME. 48 games is ~76s against
// ~27s. A gate whose sample is too small for the mechanism in the engine is
// worse than a slow one: it fails on the seed, and then it gets widened or
// ignored rather than believed.
//
// ⚠ AND THE GENERAL FORM, BECAUSE THIS WILL RECUR. Any instrument here whose
// statistic averages over cohorts within a line-year lost power at this commit,
// not just this one. The blend does not bias those estimators; it thins them.
const GAMES = Number(process.env.GAMES ?? 48);
const YEARS = Number(process.env.YEARS ?? 20);

// ⚠ A GROSS-ERROR BAR, NOT A PRECISION ONE, AND IT IS THE SAME KIND OF NUMBER
// AS experience-pricing-check's ARM 1. The realised climb carries the cohort
// horizon's own draw, the dispersion term and the paydown path, so it will not
// sit on 1/c to three decimals and a bar that demanded it would be a target.
// 10% asks "does the cohort land on its register at all". Before the fix the
// gaps were +4.8% / +28.1% / +36.5%, so this bar fails on two lines and passes
// on the third — it is not a bar drawn around the current answer.
const MAX_GAP = 0.10;
// ⚠ THE SHIPPED ARM MUST NOT DEVELOP. Its revision law is mean-one, so a
// matured cohort ends where it started. Asserted so a forward-booking change
// cannot leak onto the shipped path unnoticed.
const MAX_SHIPPED_DRIFT = 0.05;

const members = getPredefinedMarketMembers();

/** 1/c, value-weighted, over real registers. The aggregate ratio, not a mean. */
function targetClimb(line: CoverageLine): { value: number; count: number } {
  let drawn = 0, booked = 0;
  const per: number[] = [];
  for (let y = 1; y <= 25; y++) {
    const base = {
      members, yearNumber: 1, calendarYear: 2026,
      instanceSeed: 6_100_000 + y * 7919, riskControlEffectiveness: 0,
    };
    const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
      : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
        : generatePropertyClaims({ ...base, kPr: 1 });
    for (const c of r.claims) {
      const b = initialEstimate(line, c.grossUltimate);
      drawn += c.grossUltimate; booked += b;
      if (b > 0) per.push(c.grossUltimate / b);
    }
  }
  return { value: drawn / booked, count: per.reduce((a, b) => a + b, 0) / per.length };
}

type Coh = {
  yearNumber: number; age: number; horizon: number; seeded?: boolean;
  netUltimate: number; cededDevelopmentToDate?: number;
  grossPaid?: number; grossUnpaid?: number;
};

interface Arm { gOpen: number; gTerm: number; nOpen: number; nTerm: number; ced: number; n: number }

function runArm(flagged: boolean): Record<string, Arm> {
  const was = FORWARD_BOOKING.enabled;
  FORWARD_BOOKING.enabled = flagged;
  const acc: Record<string, Arm> = {};
  for (const l of LINES) acc[l] = { gOpen: 0, gTerm: 0, nOpen: 0, nTerm: 0, ced: 0, n: 0 };
  try {
    for (let g = 0; g < GAMES; g++) {
      const id = `MA${flagged ? 'F' : 'S'}${g}`;
      const instance = generateGameInstance(id, 2_200_000 + g * 7919);
      const setup = { poolName: 'M', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
      const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
      let gs: GameState = {
        setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      let st = poolState;
      const open = new Map<string, { g: number; n: number }>();
      const term = new Map<string, { g: number; n: number; c: number }>();
      for (let y = 1; y <= YEARS; y++) {
        const p = processYear(gs, defaultDecisionSet(y));
        st = p.updatedPoolState;
        const S = st as never as { lines: Record<string, { reserveCohorts: Coh[] }> };
        for (const l of LINES) {
          for (const c of S.lines[l]?.reserveCohorts ?? []) {
            if (c.seeded) continue;
            const gu = (c.grossPaid ?? 0) + (c.grossUnpaid ?? 0);
            if (!(gu > 0)) continue;
            const key = `${l}|${c.yearNumber}`;
            if (c.age === 0 && !open.has(key)) open.set(key, { g: gu, n: c.netUltimate });
            // ⚠ THE MATURITY-BIAS FILTER. Only accident years with room for the
            // LONGEST horizon their line can draw, so the sample is not tilted
            // toward the short horizons that happen to finish inside the game.
            if (c.age >= c.horizon && open.has(key)
              && c.yearNumber <= YEARS - IBNER_HORIZON[l].max) {
              term.set(key, { g: gu, n: c.netUltimate, c: c.cededDevelopmentToDate ?? 0 });
            }
          }
        }
        gs = { ...gs, currentYearNumber: y + 1, poolState: st, lockedResults: [...gs.lockedResults, p.result] };
      }
      for (const [key, t] of term) {
        const l = key.split('|')[0];
        const o = open.get(key)!;
        acc[l].gOpen += o.g; acc[l].gTerm += t.g;
        acc[l].nOpen += o.n; acc[l].nTerm += t.n; acc[l].ced += t.c;
        acc[l].n++;
      }
    }
  } finally { FORWARD_BOOKING.enabled = was; }
  return acc;
}

const FB_AT_ENTRY = FORWARD_BOOKING.enabled;
// ⚠ NAMED BY THE FLAG, NOT BY WHICH ARM SHIPS. They were `shipped` and
// `flagged`, and at the flip both names started saying the opposite of what
// they held — the same inversion pregame-acceptance-check's bounds note records
// and the reason a gate should never encode which arm is current.
const flagOff = runArm(false);
const flagOn = runArm(true);
// ⚠ CAPTURED, NOT HARDCODED, for the reason ratemaking-loop-check records: a
// literal here asserts WHICH ARM SHIPS, which is a ruling, when what is meant is
// that this gate puts the flag back.
if (FORWARD_BOOKING.enabled !== FB_AT_ENTRY) {
  console.log('⚠ FORWARD_BOOKING WAS NOT RESTORED — this gate mutates it and must put it back');
  process.exitCode = 1;
}

const failures: string[] = [];
console.log(RULE);
console.log('MATURITY ANCHOR — DOES THE COHORT DEVELOP BACK TO ITS REGISTER?');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years per arm, identical seeds. Value-weighted throughout.\n`);

console.log('--- THE ASSERTION: gross climb against 1/c, SHIPPED arm (flag ON) ---');
console.log('  line       1/c value-wtd   (1/c count-wtd)   GROSS climb      gap    verdict');
for (const line of LINES) {
  const t = targetClimb(line);
  const a = flagOn[line];
  if (a.n === 0 || !(a.gOpen > 0)) {
    failures.push(`${line}: no matured cohorts with room for horizon ${IBNER_HORIZON[line].max} — raise YEARS`);
    continue;
  }
  const climb = a.gTerm / a.gOpen;
  const gap = climb / t.value - 1;
  const ok = Math.abs(gap) <= MAX_GAP;
  console.log(`  ${line.padEnd(9)} ${t.value.toFixed(4).padStart(13)}   ${('(' + t.count.toFixed(4) + ')').padStart(15)}   `
    + `${climb.toFixed(4).padStart(11)}   ${((gap >= 0 ? '+' : '') + (100 * gap).toFixed(1) + '%').padStart(7)}    ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) {
    failures.push(`${line}: the cohort develops to ${climb.toFixed(4)} of its booked register against a `
      + `target of ${t.value.toFixed(4)} — ${(gap >= 0 ? '+' : '') + (100 * gap).toFixed(1)}%, outside the `
      + `${(100 * MAX_GAP).toFixed(0)}% bound.`);
  }
}

console.log('\n--- THE NULL: the RETIRED arm (flag OFF) must not develop ---');
console.log('  line       GROSS climb   verdict');
for (const line of LINES) {
  const a = flagOff[line];
  if (!(a.gOpen > 0)) continue;
  const climb = a.gTerm / a.gOpen;
  const ok = Math.abs(climb - 1) <= MAX_SHIPPED_DRIFT;
  console.log(`  ${line.padEnd(9)} ${climb.toFixed(4).padStart(11)}   ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) {
    failures.push(`${line}: the RETIRED arm developed to ${climb.toFixed(4)}. Its revision law is mean-one `
      + 'and a matured cohort must end where it started. Forward booking has leaked into the code that '
      + 'runs when the flag is OFF, so the flag no longer isolates the mechanism — never excused.');
  }
}

// ============================================================================
console.log('\n--- READING, NOT ASSERTED: the net side and the tower ---');
console.log('  line       NET climb    net gap   ceded/open   absorption');
for (const line of LINES) {
  const t = targetClimb(line), a = flagOn[line];
  if (!(a.nOpen > 0)) continue;
  const nClimb = a.nTerm / a.nOpen;
  const nGap = nClimb / t.value - 1;
  const ceded = a.ced / a.nOpen;
  const gGap = a.gTerm / a.gOpen / t.value - 1;
  const absorbed = Math.abs(gGap) > 1e-9 ? 1 - Math.abs(nGap) / Math.abs(gGap) : NaN;
  console.log(`  ${line.padEnd(9)} ${nClimb.toFixed(4).padStart(9)}   ${((nGap >= 0 ? '+' : '') + (100 * nGap).toFixed(1) + '%').padStart(7)}   `
    + `${ceded.toFixed(4).padStart(10)}   ${Number.isFinite(absorbed) ? (100 * absorbed).toFixed(0) + '%' : '  -'}`);
}
console.log('');
console.log('  ⚠ THE SEVERITY ANCHOR DEPENDS ON THE REINSURANCE PROGRAMME, AND THIS IS TRUE');
console.log('  WHATEVER THE GROSS LEG READS. ceded/open differs 6x between lines, and the');
console.log('  absorption of any gross error is set by that share rather than by any mechanism');
console.log('  linking the tower to the drift schedule. ANYONE CHANGING THE TOWER MOVES THE NET');
console.log('  TERMINAL, on every line, by an amount no gate here constrains.');

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE COHORT LANDS ON ITS REGISTER — every line, both arms.');
  console.log(RULE);
}
