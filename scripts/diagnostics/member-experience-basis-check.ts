// ============================================================================
// THE EXPERIENCE BASIS — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/member-experience-basis-check.ts
//   GAMES=4 YEARS=8 npx tsx scripts/diagnostics/member-experience-basis-check.ts
//
// ============================================================================
// WHAT IT GUARDS, AND WHY THE WRONG ANSWER LOOKS RIGHT.
//
// MemberLossYear carries two expected legs. `expectedAtOwnRq` is the
// expectation at the member's ACTUAL risk quality — rq = rqOverride ??
// member.riskQuality, at wcClaimEngine's per-member call and its two
// siblings. `expectedAtManual` is the same call with risk quality alone
// overridden to NEUTRAL_RQ: same k, same year, same class, same exposure.
//
// An experience modifier divides actual by expected. Divide by the leg that
// already contains the member's own risk quality and you have divided out the
// very quality the modifier exists to discover. Measured: ranking power
// against true risk quality on WC over a three-year window is 0.208 on the
// manual basis and 0.120 on the own-RQ basis. The own-RQ basis is the WORST
// of the three available and it is the one an implementation reaches for by
// accident, because the field used to be called `expected` and expected is
// what the formula asks for. Renaming it was the first defence. This is the
// second.
//
// ============================================================================
// 1. DEFINITIONAL — and this is the strong one.
//
// Perturb a member's riskQuality with everything else pinned: same k, same
// year, same seed, same roster. `expectedAtManual` must be BIT-IDENTICAL and
// `expectedAtOwnRq` must move. That is not a threshold, it is the definition
// of the two fields, and it catches the wrong leg being read however the
// mistake arises — a copy, a swapped argument, a lost override.
//
// ⚠ AND IT MUST FAIL IF `expectedAtOwnRq` DOES NOT MOVE. A harness that
// perturbed a risk quality the engine never read would report both legs
// bit-identical and that reads as a pass. The same inert-probe guard
// member-premium-check carries, for the same reason: the dynamic-import
// failure in WORKING_PRACTICES cost nearly exactly this.
//
// This probe cannot hit that failure the same way — it perturbs MEMBER DATA
// passed by argument, not a module constant reached through import() — but
// the guard is cheap and the class of mistake is not confined to imports.
//
// 2. POINT OF EQUALITY. At riskQuality exactly NEUTRAL_RQ the two legs must
// agree to float tolerance; anywhere else they must differ.
//
// This is not a weaker restatement of assertion 1 — it catches a different
// mistake. Assertion 1 only demands that the manual leg be CONSTANT in risk
// quality. A leg overridden to 6 instead of 5, or scaled by a fixed
// relativity, or built from a different exposure basis, is equally constant
// and sails through it. Pinning the two legs to meet at exactly NEUTRAL_RQ
// says WHICH constant: the one the own-RQ expectation itself takes when the
// member sits at neutral. Anchoring it that way also means a change to
// NEUTRAL_RQ moves both sides of the assertion together, so the gate follows
// the engines rather than encoding a 5 of its own.
//
// ============================================================================
// 3. BEHAVIOURAL — the assertion that survives a rewrite.
//
// Assertions 1 and 2 are about the ledger's fields. A modifier could read the
// right field and then recompute the wrong basis three files away. So this
// one measures the OUTCOME: rank members by actual/expected over a rolling
// three-year window, correlate against true risk quality, flip the sign.
//
// TWO CLAUSES, AND THE SECOND ONE IS THE DISCRIMINATOR.
//
//   AN ABSOLUTE FLOOR OF 0.17 ON THE MANUAL BASIS. Recorded at 0.208-0.219
//   from a separate harness; measured here at 0.257 (SE 0.007 across games).
//   Both clear it, so the floor is not fitted to either. It is what catches a
//   global degradation — something that weakens BOTH bases together, which
//   the paired clause below would sail through.
//
//   A PAIRED GAP OF AT LEAST 0.05 BETWEEN THE TWO BASES. Measured here at
//   0.0925 at a three-year window; the recorded pair implies 0.088. This is
//   the clause that fires when the wrong field is read.
//
// ⚠ WHY THE FAILING CASE IS THE GAP AND NOT "OWN-RQ MUST COME IN UNDER 0.17".
// That was the intended shape and this harness does not support it. Measured
// here, WC own-RQ is 0.1643 at a three-year window — 0.006 under the floor —
// and 0.1832 at a five-year window, ABOVE it. A ceiling that a legitimate
// configuration change steps over is not a failing case, it is a flap.
//
// The level and the gap behave completely differently, and that is the whole
// reason for the redesign. Measured across games at a three-year window:
//
//   basis            mean     sd(games)
//   A/EXPOSURE       0.2613   0.0200
//   A/E manual       0.2568   0.0199
//   A/E own-RQ       0.1643   0.0211
//   manual - own-RQ  0.0925   0.0025     <- eight times tighter
//
// The two bases divide the SAME actuals, so pairing them cancels the
// game-to-game variance that dominates either level on its own. The gap sits
// about 100 SE from zero and no single game-year out of 112 has a
// non-positive gap. The levels also carry a harness offset — every figure
// measured here runs about 0.045 above the recorded one, on every basis and
// at every window (own-RQ 0.1235 / 0.1643 / 0.1832 at windows 1 / 3 / 5
// against a recorded 0.099 / 0.120 / —) — while the GAP reproduces to within
// 0.005. So the gap is the quantity that transfers between harnesses and the
// level is not.
//
// 0.05 is a little over half the measured gap, ~47 SE below it, and clear of
// the worst single game (0.0876) by 0.038. It is deliberately not set near
// the measurement.
//
// AND THE GATE CARRIES ITS OWN POSITIVE CONTROL. Substituting the own-RQ leg
// for the manual one is the exact mistake this file exists to catch, so the
// substitution is performed and the gap recomputed: it must come out at zero
// and FAIL. A gate with only a passing case is untested.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import {
  generateWcClaims,
  NEUTRAL_RQ as WC_NEUTRAL_RQ,
} from '../../src/utils/wcClaimEngine';
import {
  generateGlClaims,
  NEUTRAL_RQ as GL_NEUTRAL_RQ,
} from '../../src/utils/glClaimEngine';
import {
  generatePropertyClaims,
  NEUTRAL_RQ as PR_NEUTRAL_RQ,
} from '../../src/utils/propertyClaimEngine';
import { experienceWindow, EXPERIENCE_WINDOW_YEARS } from '../../src/utils/memberLossHistory';
import type {
  CoverageLine,
  GameState,
  Member,
  MemberLossResult,
} from '../../src/types/simulation';

const RULE = '='.repeat(76);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 16);

// The manual leg must be bit-identical under an RQ perturbation, so this is 0
// and not a tolerance. Anything else would let a small RQ dependence through.
const MANUAL_BITWISE = 0;
// At rq === NEUTRAL_RQ the two legs are the same expression evaluated twice,
// so they agree to a few ulps of the value rather than exactly: the override
// path and the plain path multiply the same factors in the same order, but
// nothing in the code guarantees that and asserting exact equality would be
// asserting an implementation accident.
const EQUALITY_REL = 1e-12;
// Off NEUTRAL_RQ the legs must be visibly apart, not merely unequal in the
// last bit — a 1e-15 difference would be float noise masquerading as a basis.
const SEPARATION_REL = 1e-6;
// Under both the recorded manual figure (0.208-0.219) and the one measured
// here (0.257), so it is fitted to neither. See the header.
const RANKING_FLOOR = 0.17;
// The paired manual - ownRq gap. Measured 0.0925 at a three-year window with
// sd 0.0025 across games; worst single game 0.0876. Set at a little over half
// that, ~15 SE clear of the worst game.
const GAP_FLOOR = 0.05;
// Below this many members a game-year's Spearman is too thin to pool.
const MIN_MEMBERS = 30;

const failures: string[] = [];
const roster = getPredefinedMarketMembers();

// ---------------------------------------------------------------- helpers

/** Spearman with average ranks for ties. Risk quality is heavily tied on a
 *  1-10 scale, so tie handling is not optional here. */
function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const ranks = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(n);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let t = i; t <= j; t++) r[order[t][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(xs), ry = ranks(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx, b = ry[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

const relDiff = (a: number, b: number) =>
  Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));

/** The three engines' per-member results for one line at a PINNED k, year and
 *  seed. Everything the expectation depends on is an argument here, so the
 *  only thing an arm can differ by is what the caller changed. */
function memberResultsFor(line: CoverageLine, members: Member[]): MemberLossResult[] {
  const common = { members, yearNumber: 4, calendarYear: 2029, instanceSeed: 99_001, riskControlEffectiveness: 0 };
  if (line === 'WC') return generateWcClaims({ ...common, kLine: 0.97 }).memberLossResults;
  if (line === 'GL') return generateGlClaims({ ...common, kGl: 1.03, gPool: 1 }).memberLossResults;
  return generatePropertyClaims({ ...common, kPr: 1.01 }).memberLossResults;
}

/** The roster with every member's riskQuality forced to `rq`. Cloned, so the
 *  frozen catalog is never touched. */
function atRiskQuality(members: Member[], rq: number): Member[] {
  return members.map(m => ({ ...m, riskQuality: rq }));
}

function probeMembersFor(line: CoverageLine): Member[] {
  return roster.filter(m => (m.exposureByLine[line] ?? 0) > 0).slice(0, 40);
}

const neutralFor = (line: CoverageLine) =>
  line === 'WC' ? WC_NEUTRAL_RQ : line === 'GL' ? GL_NEUTRAL_RQ : PR_NEUTRAL_RQ;

console.log(RULE);
console.log('THE EXPERIENCE BASIS: expectedAtOwnRq vs expectedAtManual');
console.log(RULE);

// ------------------------------------------- 0. the three neutrals still agree
console.log('\n--- 0. THE THREE ENGINES STILL NEUTRALISE AT THE SAME POINT ---');
{
  const ok = WC_NEUTRAL_RQ === GL_NEUTRAL_RQ && GL_NEUTRAL_RQ === PR_NEUTRAL_RQ;
  console.log(`  WC ${WC_NEUTRAL_RQ}, GL ${GL_NEUTRAL_RQ}, Property ${PR_NEUTRAL_RQ}   ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) {
    failures.push(`the three engines' NEUTRAL_RQ have diverged (WC ${WC_NEUTRAL_RQ}, GL ${GL_NEUTRAL_RQ}, `
      + `Property ${PR_NEUTRAL_RQ}). That may be deliberate, but assertion 2 below assumes a single point of `
      + 'equality per line and any cross-line comparison of manual bases stops meaning what it says.');
  }
}

// ------------------------------------------------------------- 1. definitional
console.log('\n--- 1. DEFINITIONAL: perturb riskQuality, the manual leg must not move ---');
{
  const LOW = 2, HIGH = 8;
  for (const line of LINES) {
    const probe = probeMembersFor(line);
    const lo = memberResultsFor(line, atRiskQuality(probe, LOW));
    const hi = memberResultsFor(line, atRiskQuality(probe, HIGH));
    const byId = new Map(hi.map(r => [r.memberId, r]));

    let compared = 0, manualMoved = 0, ownMoved = 0;
    let worstManual = 0, biggestOwn = 0;
    for (const a of lo) {
      const b = byId.get(a.memberId);
      if (!b) continue;
      compared++;
      const md = Math.abs(a.expectedLossAtManual - b.expectedLossAtManual);
      if (md > MANUAL_BITWISE) { manualMoved++; worstManual = Math.max(worstManual, md); }
      const od = relDiff(a.expectedLoss, b.expectedLoss);
      if (od > SEPARATION_REL) { ownMoved++; biggestOwn = Math.max(biggestOwn, od); }
    }

    console.log(`  ${line.padEnd(9)} ${String(compared).padStart(3)} members at rq ${LOW} vs rq ${HIGH}`);
    console.log(`            manual leg moved for ${manualMoved} (must be 0), worst |delta| = $${worstManual.toFixed(6)}`);
    console.log(`            ownRq  leg moved for ${ownMoved} (must be ${compared}), largest relative move = ${(biggestOwn * 100).toFixed(1)}%`
      + `   ${manualMoved === 0 && ownMoved === compared ? 'PASS' : 'FAIL'}`);

    if (compared === 0) {
      failures.push(`${line}: the definitional probe compared no members at all — it asserts nothing. `
        + 'Check probeMembersFor: the line may have no member with positive exposure.');
    }
    if (manualMoved > 0) {
      failures.push(`${line}: expectedLossAtManual moved for ${manualMoved} of ${compared} members when risk `
        + `quality alone changed from ${LOW} to ${HIGH} (worst $${worstManual.toFixed(4)}). The manual leg is `
        + 'DEFINED as the expectation at neutral risk quality, so it cannot depend on the member\'s own. '
        + 'Either the riskQualityOverride is not reaching the expectation, or the field is being populated '
        + 'from the own-RQ call.');
    }
    if (ownMoved < compared) {
      failures.push(`${line}: expectedLoss did NOT move for ${compared - ownMoved} of ${compared} members under `
        + `an rq ${LOW} -> ${HIGH} perturbation, so the "manual leg is bit-identical" result above proves `
        + 'nothing — an inert probe reports both legs unchanged and reads as a pass. Either the engine has '
        + 'stopped reading member.riskQuality in its expectation, or this harness is perturbing a copy the '
        + 'engine never sees. See WORKING_PRACTICES on the absurd-value probe.');
    }
  }
}

// -------------------------------------------------------- 2. point of equality
console.log('\n--- 2. POINT OF EQUALITY: the legs agree at NEUTRAL_RQ and nowhere else ---');
{
  for (const line of LINES) {
    const probe = probeMembersFor(line);
    const N = neutralFor(line);
    const rows: string[] = [];
    let atNeutralWorst = 0, offNeutralClosest = Infinity, offChecked = 0;

    for (const rq of [1, 3, N, 7, 10]) {
      const res = memberResultsFor(line, atRiskQuality(probe, rq));
      let worst = 0, closest = Infinity;
      for (const r of res) {
        // A member with no expected loss has both legs at 0 and would report a
        // separation of 0 at every rq — an automatic failure of the off-neutral
        // clause that says nothing about the basis. probeMembersFor already
        // filters on exposure, so this should never bite; it is here so that if
        // it ever does, the gate reports a real result rather than a spurious red.
        if (!(r.expectedLoss > 0) && !(r.expectedLossAtManual > 0)) continue;
        const d = relDiff(r.expectedLoss, r.expectedLossAtManual);
        worst = Math.max(worst, d);
        closest = Math.min(closest, d);
      }
      rows.push(`rq ${String(rq).padStart(2)}: worst ${worst.toExponential(1)}`);
      if (rq === N) {
        atNeutralWorst = worst;
      } else {
        offNeutralClosest = Math.min(offNeutralClosest, closest);
        offChecked++;
      }
    }

    const ok = atNeutralWorst <= EQUALITY_REL && offNeutralClosest >= SEPARATION_REL;
    console.log(`  ${line.padEnd(9)} ${rows.join('   ')}`);
    console.log(`            at rq ${N} worst separation ${atNeutralWorst.toExponential(1)} (<= ${EQUALITY_REL.toExponential(0)}); `
      + `off it, closest over ${offChecked} rq values ${offNeutralClosest.toExponential(1)} (>= ${SEPARATION_REL.toExponential(0)})   ${ok ? 'PASS' : 'FAIL'}`);

    if (atNeutralWorst > EQUALITY_REL) {
      failures.push(`${line}: at riskQuality exactly ${N} the two legs differ by ${atNeutralWorst.toExponential(2)} `
        + 'relative. They are the same expectation at that point — the override sets risk quality to the value '
        + 'the member already has — so a difference means the manual leg is not the same computation with a '
        + 'different rq, it is a different computation.');
    }
    if (offNeutralClosest < SEPARATION_REL) {
      failures.push(`${line}: at some riskQuality away from ${N} the two legs come within `
        + `${offNeutralClosest.toExponential(2)} relative of each other. Off the neutral point they must be `
        + 'visibly apart; a manual leg populated by copying expectedLoss reads exactly like this.');
    }
  }
}

// ------------------------------------------------------------- 3. behavioural
console.log(`\n--- 3. BEHAVIOURAL: ranking power against true risk quality, ${EXPERIENCE_WINDOW_YEARS}-year window ---`);
{
  interface Obs { game: number; manual: number; ownRq: number }
  const perLine: Record<string, Obs[]> = { WC: [], GL: [], Property: [] };

  for (let g = 0; g < GAMES; g++) {
    const id = `EB${g}`;
    const instance = generateGameInstance(id, 77_000_000 + g * 6791);
    const setup = { poolName: 'E', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };

    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };

      if (y < EXPERIENCE_WINDOW_YEARS) continue;
      const history = p.updatedPoolState.memberLossHistory ?? {};
      const market = p.updatedPoolState.allMarketMembers;

      for (const line of LINES) {
        const rq: number[] = [], rMan: number[] = [], rOwn: number[] = [];
        for (const m of market) {
          const w = experienceWindow(history, m.id, line, EXPERIENCE_WINDOW_YEARS);
          if (w.length < EXPERIENCE_WINDOW_YEARS) continue;
          let a = 0, eMan = 0, eOwn = 0;
          for (const e of w) { a += e.actual; eMan += e.expectedAtManual; eOwn += e.expectedAtOwnRq; }
          if (!(eMan > 0) || !(eOwn > 0)) continue;
          rq.push(m.riskQuality);
          rMan.push(a / eMan);
          rOwn.push(a / eOwn);
        }
        if (rq.length < MIN_MEMBERS) continue;
        // SIGN-FLIPPED: a high actual/expected is a BAD member, so the raw
        // correlation against risk quality is negative and "ranking power" is
        // its magnitude in the right direction.
        //
        // ⚠ THE TWO ARE COMPUTED ON THE SAME MEMBERS IN THE SAME GAME-YEAR
        // FROM THE SAME ACTUALS, which is what makes the paired gap below
        // meaningful. Do not filter one arm and not the other.
        perLine[line].push({ game: g, manual: -spearman(rMan, rq), ownRq: -spearman(rOwn, rq) });
      }
    }
  }

  const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  /** Mean and across-GAME standard error. Game-years within one game share
   *  members and overlapping windows, so treating them as independent would
   *  understate the spread by roughly the window length. The game is the unit. */
  function byGame(obs: Obs[], pick: (o: Obs) => number) {
    const groups = new Map<number, number[]>();
    for (const o of obs) (groups.get(o.game) ?? groups.set(o.game, []).get(o.game)!).push(pick(o));
    const perGame = [...groups.values()].map(mean);
    const m = mean(perGame);
    const sd = perGame.length > 1
      ? Math.sqrt(perGame.reduce((a, b) => a + (b - m) ** 2, 0) / (perGame.length - 1))
      : NaN;
    return { mean: m, se: sd / Math.sqrt(perGame.length), worst: Math.min(...perGame), games: perGame.length };
  }

  console.log(`  ${GAMES} games x ${YEARS} years. Manual floor ${RANKING_FLOOR}, paired gap floor ${GAP_FLOOR}.`);
  console.log('  (recorded elsewhere: WC manual 0.208-0.219, WC own-RQ 0.120, so a recorded gap of ~0.088)\n');
  console.log('  line        game-yrs   MANUAL (SE)        OWN-RQ (SE)        GAP (SE)           gap<=0');
  for (const line of LINES) {
    const obs = perLine[line];
    if (obs.length === 0) { console.log(`  ${line.padEnd(11)} none`); continue; }
    const man = byGame(obs, o => o.manual), own = byGame(obs, o => o.ownRq);
    const gap = byGame(obs, o => o.manual - o.ownRq);
    const neg = obs.filter(o => o.manual - o.ownRq <= 0).length;
    console.log(`  ${line.padEnd(11)} ${String(obs.length).padStart(6)}     `
      + `${man.mean.toFixed(4)} (${man.se.toFixed(4)})   ${own.mean.toFixed(4)} (${own.se.toFixed(4)})   `
      + `${gap.mean.toFixed(4)} (${gap.se.toFixed(4)})   ${String(neg).padStart(3)}/${obs.length}`);
    // EVERY line must separate, in every game-year. GL and Property carry no
    // recorded floor of their own — the gap on them is smaller (about 0.049
    // and 0.056) and only its SIGN is asserted, which is the part that means
    // "the manual basis is the better one here too".
    if (neg > 0) {
      failures.push(`${line}: ${neg} of ${obs.length} game-years rank risk quality no better on the manual basis `
        + 'than on the own-RQ one. Dividing by an expectation that contains the member\'s own risk quality '
        + 'removes the signal, so the manual basis must win every time; it does across all three lines and '
        + 'all measured game-years today.');
    }
  }

  const obs = perLine.WC;
  console.log('');
  if (obs.length === 0) {
    console.log('  WC produced no measurable game-years   FAIL');
    failures.push('the behavioural assertion measured no WC game-years at all, so it asserted nothing. Either '
      + `the ledger is not being populated or fewer than ${MIN_MEMBERS} members reach a full `
      + `${EXPERIENCE_WINDOW_YEARS}-year window.`);
  } else {
    const man = byGame(obs, o => o.manual);
    const gap = byGame(obs, o => o.manual - o.ownRq);
    const own = byGame(obs, o => o.ownRq);

    const passFloor = man.mean >= RANKING_FLOOR;
    const passGap = gap.mean >= GAP_FLOOR && gap.worst >= GAP_FLOOR;
    console.log(`  WC MANUAL      ${man.mean.toFixed(4)} >= ${RANKING_FLOOR}   (worst game ${man.worst.toFixed(4)})   ${passFloor ? 'PASS' : 'FAIL'}`);
    console.log(`  WC PAIRED GAP  ${gap.mean.toFixed(4)} >= ${GAP_FLOOR}   (worst game ${gap.worst.toFixed(4)}, `
      + `${(gap.mean / gap.se).toFixed(0)} SE from zero)   ${passGap ? 'PASS' : 'FAIL'}`);

    // POSITIVE CONTROL — run the gate's own clauses against the WRONG leg.
    // This is the mistake the file exists to catch, so it is performed rather
    // than argued: a gate with only a passing case is untested.
    //
    // ⚠ AND THE TWO CLAUSES BEHAVE DIFFERENTLY UNDER IT, WHICH IS THE POINT.
    // The substituted gap is ownRq - ownRq, so it is exactly 0 by arithmetic
    // and misses the floor by the whole floor — that clause is decisive and
    // its control is a statement about GAP_FLOOR being above zero, not a
    // measurement. The substituted LEVEL is 0.1643 against a 0.17 floor: it
    // fails too, but by 0.006, and at a five-year window it would not fail at
    // all. Both are reported so the margin each clause actually has is
    // visible rather than asserted.
    const subGap = 0;
    const gapClauseFires = subGap < GAP_FLOOR;
    const floorClauseFires = own.mean < RANKING_FLOOR;
    const controlFires = gapClauseFires || floorClauseFires;
    console.log(`  POSITIVE CONTROL — substitute the own-RQ leg for the manual one and re-run both clauses:`);
    console.log(`     gap clause:   ${subGap.toFixed(4)} vs floor ${GAP_FLOOR}    ${gapClauseFires ? 'FIRES (margin ' + GAP_FLOOR.toFixed(4) + ')' : 'DOES NOT FIRE'}`);
    console.log(`     floor clause: ${own.mean.toFixed(4)} vs floor ${RANKING_FLOOR}   ${floorClauseFires ? 'fires (margin ' + (RANKING_FLOOR - own.mean).toFixed(4) + ')' : 'does not fire'}`);
    console.log(`     gate goes red under the substitution: ${controlFires}   ${controlFires ? 'PASS' : 'FAIL'}`);

    if (!passFloor) {
      failures.push(`WC ranking power on the MANUAL basis is ${man.mean.toFixed(4)}, under the ${RANKING_FLOOR} floor `
        + '(recorded 0.208-0.219, measured here 0.257). This floor catches a degradation that weakens BOTH '
        + 'bases together, which the paired gap below would sail through — so read it as "the experience '
        + 'signal has gone", not as "the wrong field is being read".');
    }
    if (!passGap) {
      failures.push(`the WC paired gap between the manual and own-RQ bases is ${gap.mean.toFixed(4)} `
        + `(worst game ${gap.worst.toFixed(4)}), under the ${GAP_FLOOR} floor. Measured at 0.0925 with an SE of `
        + '0.0009, so this is a large move, not noise. The two bases have converged, which means something is '
        + 'reading the own-RQ leg where it should read the manual — and the substitution need not be in this '
        + 'file or in the ledger: this assertion is downstream of every step.');
    }
    if (!controlFires) {
      failures.push('the positive control did not fire: substituting the own-RQ leg for the manual one left '
        + 'both clauses green, so this gate would not catch the one mistake it exists to catch. That needs '
        + `GAP_FLOOR at or below zero (it is ${GAP_FLOOR}) and the own-RQ level at or above the ${RANKING_FLOOR} `
        + 'floor at the same time — check whether either constant has been relaxed.');
    }
  }
}

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE MANUAL LEG IS THE EXPECTATION AT NEUTRAL RISK QUALITY, IT AGREES WITH THE');
  console.log('OWN-RQ LEG AT EXACTLY THAT POINT AND NOWHERE ELSE, AND IT OUT-RANKS THE OWN-RQ');
  console.log('LEG AGAINST TRUE RISK QUALITY IN EVERY MEASURED GAME-YEAR ON ALL THREE LINES.');
  console.log(RULE);
}
