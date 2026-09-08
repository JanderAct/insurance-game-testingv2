// EXPERIENCE PRICING — the three measurements that justify PRICING_TRIANGLE,
// and whose passing retires it.
//
// ============================================================================
// ⚠ THIS GATE IS THE FLAG'S RETIREMENT CONDITION, WRITTEN ON DAY ONE. It is
// entered in scripts/gates.ts's EXPECTED_RED. When all three arms pass, the
// XPASS guard fails the sweep until the entry is removed — and removing it is
// the moment PRICING_TRIANGLE goes with it. PER_CLAIM_REVISION lasted weeks
// because there was always one more thing to measure; this one cannot.
//
//   1. DOES THE POOL CHARGE SANELY?  The RETAINED pure premium the pool
//      actually charges, against the REALISED retained loss cost of the very
//      accident years it charged for.
//   2. WHAT DOES THE RATE DO YEAR TO YEAR?  A rolling window should give a few
//      points of movement. Twenty is unusable.
//   3. DOES THE LOOP STAY STABLE?  Price chases the roster and the roster
//      chases price. NOT BUILT — and its absence is asserted, so this gate
//      cannot go green while the measurement that replaces finding 17's
//      protection does not exist.
//
// ⚠ ARM 3 FAILING IS THE POINT, NOT AN OVERSIGHT. The held pure premium existed
// to stop pricing chasing the roster. S3 removes that protection and nothing
// yet replaces it. Turning the flag on before arm 3 exists would ship an
// ungated feedback loop, so the gate refuses to go green and says so.
//
// ============================================================================
// ⚠ ARM 1 WAS REWRITTEN BECAUSE IT VALIDATED THE ESTIMATOR AND NOT THE PREMIUM,
// AND IT WOULD HAVE SIGNED OFF A LINE CHARGING NOTHING.
//
// The old arm compared experienceRatePer100 — computed by the gate, as an
// observer, on an arm where PRICING_TRIANGLE was OFF — against the realised
// ultimate loss cost. Both sides were NET of reinsurance, so it read a
// respectable -2.0% / +1.7% / +2.6% and passed on all three lines. Meanwhile
// the engine was handing that same retained rate to the net-funding step, which
// subtracted expected cession from it a SECOND time: GL was charging 18% of its
// correct rate and flooring at zero in half its games, WC and Property 67%.
// Nothing in this gate looked at netPurePremiumPer100, so the retirement
// condition for the flag graded a number the member is never charged.
//
// It now runs the flag ON and reads what the pool BILLS. Both sides of the
// comparison are RETAINED — netPurePremiumPer100 against a realised loss cost
// taken from ReserveDevelopmentRow.ultimateByValuation, which is net (see its
// own ⚠) — so this is one basis throughout and no conversion sits between the
// two numbers.
//
// ⚠ AND THE HELD COLUMN'S OLD "realised/held" READING IS RETRACTED, NOT
// REPRINTED. It reported 0.727 / 0.540 / 0.763 and was quoted as far as
// currentPurePremiumPer100's own header as proof that "the held rate is itself
// heavy" and therefore worth replacing. It divided a NET realised loss cost by a
// GROSS held rate: it measured the reinsurance programme's retention, not the
// held rate's adequacy. On a single basis — the held arm's own charged retained
// rate against its own realised retained cost — the held rate is close to
// correct, and "the held rate is heavy" was never a reason for this flag. The
// reason that survives is that a pool should price off its own developing
// experience rather than off a constant. The held arm is still run and still
// printed, as the baseline this one has to beat rather than as an indictment.
//
// ============================================================================
// ⚠ ARM 1 NOW RUNS WITH FORWARD_BOOKING ON TOO, WHICH THE OLD HEADER RECORDED
// AS OWED AND NOT DONE.
//
// This module chain-ladders PAID, and that choice was made because the played
// INCURRED triangle was flat — cumulative 0.9857 / 0.9912 / 1.0005, a mean-one
// law producing no development. That is a fact about the SHIPPED arm and it is
// no longer true with FORWARD_BOOKING on: within horizon the engine develops
// incurred at 1.1041 / 1.2599 / 1.1584, and ratemaking-loop-check's condition 3
// separates the two arms on every line. Arm 1's flagged run therefore sets BOTH
// flags, matching the acceptance test's arm — the pricing basis the shipped game
// would actually have if these flags flipped. Method SELECTION (paid vs
// incurred) is still open and still owed; what is closed is arm 1 reading a
// world the flags do not produce.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { experienceRatePer100, type ExperienceBasis } from '../../src/utils/experienceRating';
import { windowRows } from '../../src/utils/pricingTriangle';
import { wasActiveInLine } from '../../src/utils/membershipHistory';
import { getMemberExposure } from '../../src/utils/lineHelpers';
import { FORWARD_BOOKING, PRICING_TRIANGLE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, Member, ReserveDevelopmentRow } from '../../src/types/simulation';

const RULE = '='.repeat(72);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 40);
const YEARS = Number(process.env.YEARS ?? 15);

// Arm 1: the RETAINED rate the pool charges must land within this of the
// realised retained loss cost of the years it charged for. A gross-error
// detector — it is asking "is this a price at all", not "is it precise".
const MAX_LEVEL_ERROR = 0.25;
// Arm 2: share of year-on-year moves above 20%, the brief's own unusable bar.
const MAX_BIG_MOVE_SHARE = 0.05;

const failed: string[] = [];
const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);

type Arm = {
  /** Paired per mature accident year: what the pool CHARGED for it, retained. */
  charged: Record<string, number[]>;
  /** The same years' REALISED retained ultimate loss cost. Same index. */
  realised: Record<string, number[]>;
  /** Line-years whose charged retained rate was floored at zero by the
   *  net-funding step — the double deduction's most visible symptom. */
  floored: Record<string, number>;
  lineYears: Record<string, number>;
  /** Arm 2: |year-on-year move| in the experience estimator. */
  yoy: Record<string, number[]>;
};

/**
 * ⚠ BOTH ARMS PLAY THE GAME. The held arm is not an observer computing a rate
 * beside a run it is not part of — that is what the old arm 1 did, and it is
 * how a rate nobody is charged came to be the thing under test. Each arm plays
 * its own games under its own pricing and is graded against the losses THOSE
 * games produced.
 */
function runArm(flagged: boolean): Arm {
  const wasF = FORWARD_BOOKING.enabled, wasP = PRICING_TRIANGLE.enabled;
  FORWARD_BOOKING.enabled = flagged;
  PRICING_TRIANGLE.enabled = flagged;

  const arm: Arm = { charged: {}, realised: {}, floored: {}, lineYears: {}, yoy: {} };
  for (const l of LINES) { arm.charged[l] = []; arm.realised[l] = []; arm.floored[l] = 0; arm.lineYears[l] = 0; arm.yoy[l] = []; }

  try {
    for (let g = 0; g < GAMES; g++) {
      const id = `EP${flagged ? 'F' : 'S'}${g}`;
      const instance = generateGameInstance(id, 5_500_000 + g * 7919);
      const setup = { poolName: 'E', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
      const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
      let gs: GameState = {
        setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      let st = poolState;
      const prev: Record<string, number> = {};
      // accident year -> the retained rate the pool charged for it, this game.
      const chargedFor: Record<string, Map<number, number>> = {};
      for (const l of LINES) chargedFor[l] = new Map();

      for (let y = 1; y <= YEARS; y++) {
        const S = st as never as {
          allMarketMembers: Member[]; membershipHistory: never;
          lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[]; members: Member[] }>;
        };
        for (const line of LINES) {
          // ARM 2 ONLY, and computed here rather than read off the result
          // because the estimator's own movement is the question — including in
          // the years it returns null and the held rate stands in.
          //
          // ⚠ WINDOWED, BECAUSE THE ENGINE IS. processLineYear builds its basis
          // from windowRows(reserveDevelopment) — ten accident years — so a
          // gate reading the FULL ledger would report on a rate the pool never
          // charges. That is the panel/engine parity defect one layer out, and
          // it appeared the moment the window landed rather than being latent.
          //
          // It is not cosmetic on WC. Windowed rate over full-ledger rate, 20
          // games: WC 0.9348 shipped / 0.8882 flagged; GL 1.0059 / 0.9762;
          // Property 0.9939 / 1.0006. WC alone moves, for the reason the window
          // rule turns on: it is the only line with value still open when the
          // window drops a year (23.9% at age 10, against GL 0.4% and Property
          // 0.2%), so retiring mature accident years retires its most developed
          // loss costs and leaves the level greener. GL and Property have
          // nothing left to lose by then.
          const basis: ExperienceBasis = {
            rows: windowRows(S.lines[line]?.reserveDevelopment ?? []),
            allMarketMembers: S.allMarketMembers,
            membershipHistory: S.membershipHistory,
          };
          const exp = experienceRatePer100(line, basis);
          if (exp !== null && exp > 0) {
            if (prev[line] !== undefined && prev[line] > 0) arm.yoy[line].push(Math.abs(exp / prev[line] - 1));
            prev[line] = exp;
          }
        }

        const p = processYear(gs, defaultDecisionSet(y));
        st = p.updatedPoolState;
        // ⚠ THE NUMBER THE MEMBER IS ACTUALLY CHARGED FOR, before the CLF and
        // before admin and reinsurance are added: netPurePremiumPer100 is the
        // pool premium's own basis. Retained, so it is directly comparable to
        // the realised net ultimate below with nothing in between.
        for (const lr of p.lineResults) {
          const r = lr.result as never as Record<string, number>;
          chargedFor[lr.line].set(y, r.netPurePremiumPer100);
          arm.lineYears[lr.line]++;
          if (!(r.netPurePremiumPer100 > 0)) arm.floored[lr.line]++;
        }
        gs = { ...gs, currentYearNumber: y + 1, poolState: st, lockedResults: [...gs.lockedResults, p.result] };
      }

      // Realised retained loss cost on accident years this game ran to maturity,
      // PAIRED WITH WHAT THAT SAME YEAR WAS CHARGED.
      const S = st as never as {
        allMarketMembers: Member[]; membershipHistory: never;
        lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[]; members: Member[] }>;
      };
      for (const line of LINES) {
        for (const r of S.lines[line]?.reserveDevelopment ?? []) {
          // ⚠ NOT WINDOWED, and for the same reason the old arm gave: the
          // window is a pricing convention, not a fact about the losses. What a
          // played accident year cost is a statement about that year.
          if (r.seeded) continue;
          const u = r.ultimateByValuation ?? [];
          const lastAge = (r.ageAtFirstValuation ?? 0) + u.length - 1;
          if (lastAge < r.horizon || u.length === 0) continue;
          const chargedRate = chargedFor[line].get(r.yearNumber);
          if (chargedRate === undefined) continue;
          let e = 0;
          for (const m of S.allMarketMembers) {
            if (wasActiveInLine(S.membershipHistory, m.id, line, r.yearNumber)) e += getMemberExposure(m, line, r.yearNumber);
          }
          if (!(e > 0)) continue;
          arm.realised[line].push(u[u.length - 1] / (e * 10_000));
          arm.charged[line].push(chargedRate);
        }
      }
    }
  } finally { FORWARD_BOOKING.enabled = wasF; PRICING_TRIANGLE.enabled = wasP; }
  return arm;
}

const held = runArm(false);
const exp = runArm(true);

console.log(RULE);
console.log('EXPERIENCE PRICING — the three measurements at PRICING_TRIANGLE');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years, identical seeds on both arms.\n`);

console.log('--- ARM 1: DOES THE POOL CHARGE SANELY? ---');
console.log('  The RETAINED pure premium the pool BILLS, against the realised retained loss');
console.log('  cost of the same accident years. ONE BASIS: netPurePremiumPer100 against');
console.log('  ultimateByValuation, both net of reinsurance. The held arm is the baseline.');
console.log('  ⚠ This grades the PREMIUM. It used to grade the estimator, and passed while');
console.log('    GL was billing 18% of its correct rate.\n');
console.log('  line       years   realised/100   HELD arm charged   ratio   |   TRIANGLE charged   ratio     verdict');
for (const line of LINES) {
  const rE = mean(exp.realised[line]), cE = mean(exp.charged[line]);
  const rH = mean(held.realised[line]), cH = mean(held.charged[line]);
  const err = cE / rE - 1;
  const ok = Math.abs(err) <= MAX_LEVEL_ERROR;
  console.log(`  ${line.padEnd(10)} ${String(exp.charged[line].length).padStart(5)}   ${rE.toFixed(4).padStart(12)}   `
    + `${cH.toFixed(4).padStart(16)}   ${(cH / rH).toFixed(3).padStart(5)}   |   `
    + `${cE.toFixed(4).padStart(16)}   ${(cE / rE).toFixed(3).padStart(5)}   `
    + `${(err >= 0 ? '+' : '') + (100 * err).toFixed(1)}%  ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) {
    failed.push(`ARM 1 ${line}: the pool charges a retained pure premium ${(100 * err).toFixed(1)}% from the `
      + `realised retained loss cost, outside the ${(100 * MAX_LEVEL_ERROR).toFixed(0)}% bound.`);
  }
}
// ⚠ THE FLOOR IN netPurePremiumPer100 = max(0, gross - ceded) HAD NEVER BOUND
// UNTIL THE DOUBLE DEDUCTION MADE IT BIND, and its binding is silent: the line
// simply charges nothing and the pool funds the year out of surplus. Reported
// unconditionally so it can never go unnoticed again, and asserted, because a
// line charging zero is not a pricing error that a level test would catch — the
// level test would see a small number, not an absent one.
console.log('\n  line-years whose charged retained rate FLOORED AT ZERO:');
for (const line of LINES) {
  const f = exp.floored[line], n = exp.lineYears[line];
  const h = held.floored[line];
  console.log(`  ${line.padEnd(10)} triangle ${String(f).padStart(4)} / ${n}   held ${String(h).padStart(4)} / ${held.lineYears[line]}`);
  if (f > 0) {
    failed.push(`ARM 1 ${line}: ${f} of ${n} line-years charged NOTHING — netPurePremiumPer100 `
      + 'floored at zero. Expected cession exceeded the whole priced rate.');
  }
}

// ⚠ ASSERTED ON THE ARM THAT WOULD SHIP, AND BOTH ARE PRINTED BECAUSE THE
// NUMBER MOVED. This arm used to be read on the SHIPPED ledger only, where GL
// failed at 11.3% — attributed to GL's 3.2x first paid factor developing an
// immature year. On the ledger the flags actually produce, GL reads a third of
// that. The estimator did not get better; it is reading a different ledger,
// because FORWARD_BOOKING books development forward and the accident year GL
// was over-reacting to is no longer as raw when the window sees it. Both
// columns stay visible so the drop cannot be mistaken for the fix, and the
// assertion is on the flagged column because that is the rate a player would be
// charged if the flags flipped.
const yoyStats = (v0: number[]) => {
  const v = [...v0].sort((a, b) => a - b);
  return {
    med: v[Math.floor(0.5 * v.length)] ?? NaN,
    p90: v[Math.floor(0.9 * v.length)] ?? NaN,
    big: v.length ? v.filter(x => x > 0.2).length / v.length : NaN,
  };
};
console.log('\n--- ARM 2: WHAT DOES THE RATE DO YEAR TO YEAR? ---');
console.log('  The experience estimator\'s own movement. Asserted on the FLAGGED ledger —');
console.log('  the one the flags produce — with the shipped ledger printed beside it.');
console.log('  line      | FLAGGED  median   p90    >20%  | SHIPPED  median   p90    >20%');
for (const line of LINES) {
  const f = yoyStats(exp.yoy[line]), h = yoyStats(held.yoy[line]);
  console.log(`  ${line.padEnd(9)} | ${(100 * f.med).toFixed(1).padStart(14)}% ${(100 * f.p90).toFixed(1).padStart(6)}% `
    + `${(100 * f.big).toFixed(1).padStart(6)}% | ${(100 * h.med).toFixed(1).padStart(14)}% `
    + `${(100 * h.p90).toFixed(1).padStart(6)}% ${(100 * h.big).toFixed(1).padStart(6)}%`);
  if (f.big > MAX_BIG_MOVE_SHARE) {
    failed.push(`ARM 2 ${line}: ${(100 * f.big).toFixed(1)}% of years move more than 20%, over the `
      + `${(100 * MAX_BIG_MOVE_SHARE).toFixed(0)}% bound. A rolling window should give a few points, not twenty.`);
  }
}

console.log('\n--- ARM 3: DOES THE LOOP STAY STABLE? ---');
console.log('  Price chases the roster through the enrolled book; the roster chases price');
console.log('  through member movement. The held pure premium is what broke that loop, and');
console.log('  S3 removes it. NOT BUILT.');
failed.push('ARM 3: loop stability is NOT MEASURED. It is the protection finding 17 relied on and '
  + 'S3 removes it, so PRICING_TRIANGLE must not be enabled until this arm exists and passes. '
  + 'Build it as: perturb the rate, run the roster forward, and assert enrolment and rate both '
  + 'settle rather than diverging or oscillating.');

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log('');
  console.log('⚠ EXPECTED RED PENDING ARM 3 AND GL. This gate is PRICING_TRIANGLE\'s retirement');
  console.log('  condition: when all three arms pass, remove its EXPECTED_RED entry and the flag');
  console.log('  goes with it. Do not turn the flag on before then.');
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('ALL THREE MEASUREMENTS PASS — PRICING_TRIANGLE HAS NOTHING LEFT TO JUSTIFY IT.');
  console.log('Remove its EXPECTED_RED entry in scripts/gates.ts, delete the flag, and make the');
  console.log('experience rate unconditional.');
  console.log(RULE);
}
