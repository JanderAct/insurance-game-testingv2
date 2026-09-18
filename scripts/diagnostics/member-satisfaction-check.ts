// ============================================================================
// PER-MEMBER SATISFACTION — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/member-satisfaction-check.ts
//   GAMES=8 YEARS=10 npx tsx scripts/diagnostics/member-satisfaction-check.ts
//
// ============================================================================
// THE FIRST ASSERTION IS THAT THE FIELD MOVES AT ALL, AND IT IS THE ONE THAT
// WOULD HAVE CAUGHT THE THING THIS REPLACES.
//
// Member.satisfaction was drawn once at enrolment and never updated — measured
// on the version this rebuild replaced, it changed in 70 of 18,239 member-year
// pairs, and every one of those was a member re-joining and drawing afresh. It
// stayed that way for months, through a departure rebuild that deleted its only
// consumer, because NOTHING IN THE REPO EVER ASKED IT TO MOVE. A frozen field
// with no reader is invisible to every other gate here: it breaks no identity,
// moves no baseline and fails no null.
//
// So section 1 is not a formality. It is the specific gate whose absence let a
// dead mechanic ship, and it is stated as a share of member-years rather than
// as "not constant" because "not constant" would have passed on the re-joins.
//
// ============================================================================
// AND THE SECOND ASSERTION IS THAT IT STILL FEEDS NOTHING.
//
// The ruling is that this is a SCOREBOARD: measured, displayed, consumed by no
// decision. That is not a property a run can demonstrate — an engine test can
// only show that today's seeds do not happen to route through it. Section 2 is
// therefore STATIC: it reads src/ and asserts that the set of files touching
// `.satisfaction` is exactly the allow-list below.
//
// ⚠ WHICH MEANS THE ALLOW-LIST IS THE RULING, AND ADDING A FILE TO IT IS THE
// DECISION. Anyone wiring satisfaction into departure or recruitment will have
// to edit this list, and at that moment memberSatisfaction.ts's three
// preconditions are what they should be reading. That is the point of putting
// the ruling in a gate rather than in a comment. Same discipline as
// surface-privacy-check, which holds risk quality off every render path.
//
// ============================================================================
// EIGHT SECTIONS, AND FOUR LIMBS.
//
// ⚠ THE MODEL HAS FOUR LIMBS NOW AND THREE OF THEM FEED THE ANCHOR. The change
// limb reacts to the pool's price against the market, amplified per member; the
// anchor carries the market LEVEL, the member's own loss standing, and the
// pool's surplus band. Sections 5, 6 and 8 each had to change for that, and
// section 5's old assertion is now FALSE BY DESIGN — see its header.
//
//   1. IT MOVES. Share of member-years that change, per line, against a null
//      arm with ALL FOUR weights at 0 which must move only by the re-join draw.
//
//      ⚠ THAT NULL ONLY ZEROED TWO OF THEM UNTIL THE DAY THE THIRD AND FOURTH
//      LIMBS SHIPPED, AND IT WENT RED SAYING 88% OF MEMBER-YEARS MOVED "WITH THE
//      WEIGHT AT 0". A null arm that leaves half the model running measures the
//      half it left running. Every weight is listed at the arm.
//   2. IT FEEDS NOTHING. Static allow-list over src/.
//   3. DRIFT AT DEFAULTS, AND IT IS NOW THE NET OF TWO LIMBS. The convex change
//      term pulls down on a noisy gap; the anchor pulls up, because at defaults
//      the pool is 6-9% cheaper than the modelled market. Either can wander and
//      the bound covers their sum, which is the only thing a player sees. This
//      is also precondition 3 for ever promoting the field into departure.
//
//      ⚠ AND THE ANCHOR IS WHY THE DRIFT IS SMALL RATHER THAN A SECOND WAY TO
//      WANDER. Before it the stock was a random walk driven by a convex reaction
//      to a noisy gap, with nothing pulling back; with it the same noise is
//      transient and the process mean-reverts. Measured, WC went -0.0115 to
//      +0.0073 per member-year and the six-year decision footprint's standard
//      error fell from 0.014 to 0.006.
//   4. THE CHANGE REACTION IS CONVEX, at named points, against the linear form
//      it replaces. The whole claim of the convex rebuild is that an ordinary
//      year goes quiet while a decision bites, so the RATIO is asserted rather
//      than the shape being taken on trust. The LEVEL limb's own shape is
//      asserted in market-conditions-check section 7, next to the cushion it
//      reads.
//   5. A MEMBER'S OWN EXPERIENCE CANNOT MOVE THEIR SATISFACTION. The ruling,
//      asserted directly: inside one line-year every member must take an
//      IDENTICAL delta however differently their own modifiers moved. It counts
//      the line-years where the modifiers actually DO differ, so the test cannot
//      pass on a flat sample, and it carries its own control — the same test with
//      the modifier added back into the gap must fail.
//   6. ONE MEMBER, ONE DECISION. The averages in the other sections hide what a
//      player actually sees. This traces one member through a game in which the
//      funding slider moves one stop, seed-matched against the same member in
//      the same game with it left alone.
//   7. POSITIVE CONTROL. A seed-matched pool priced above the market must end
//      unhappier. A satisfaction model that never responds to price is the
//      frozen field again with more arithmetic in front of it.
//   8. THE TWO NEW LIMBS CARRY THEIR OWN DERIVATIONS. lossLevelWeight's rule is
//      that term 3's cross-member spread is worth one funding stop through the
//      market level — it shipped at 0.45 producing 0.069 against a 0.116 target
//      and this is what caught it. The uncapped ratio must stay heavy-tailed
//      (the saturation exists for that) while the reaction stays bounded. And the
//      surplus band must not saturate on WC and GL, which is why the shipped
//      capitalAdequacyStatus ladder was read but its top boundary was not reused.
//
// ⚠ SECTION 5 HAS NOW BEEN THREE DIFFERENT TESTS AND THE HISTORY IS THE POINT.
//
// It began as "among members facing an increase over +2pp, the blameless ones
// are unhappier" — one wide bucket, NOT controlled for the size of the increase
// inside it. At-fault members sit higher in that bucket (a member whose mod has
// risen has both a bigger bill change and a worse ratio), so the two arms were
// never facing "the same increase". Under a linear reaction the fault damping
// still won and it passed; under a convex one the gap term won and it failed.
// It was measuring the wrong thing throughout and the form change only exposed
// it.
//
// It then became the same comparison inside controlled gap bands, which was
// correct and is now moot: the fault term is retired, so there is no damping to
// measure. What replaced it asserts the RULING instead of a consequence of it —
// a member's own experience rating cannot move their satisfaction at all — and
// that is a stronger test than either, because it fails on any leak rather than
// on a ranking.
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { SATISFACTION, satisfactionReaction } from '../../src/utils/memberSatisfaction';
import { OPENING_SATISFACTION } from '../../src/data/memberCatalog';
import type {
  CoverageLine, DecisionSet, GameState, Member, SatisfactionMove,
} from '../../src/types/simulation';

const RULE = '='.repeat(78);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 24);
const YEARS = Number(process.env.YEARS ?? 10);
/** Share of member-years that must move for the field to count as alive. */
const MIN_MOVED_SHARE = 0.50;
/**
 * What the NULL arm is allowed to move. Not zero: re-enrolment draws a fresh
 * satisfaction, so a member who leaves and comes back changes it with the
 * mechanism switched off. Measured at 0.86% here; the frozen field this
 * replaces measured 0.4% and that residue was the whole of its movement.
 */
const MAX_NULL_SHARE = 0.02;
/**
 * Satisfaction points per member-year.
 *
 * ⚠ AND IT NEEDS SAMPLE, WHICH IS WHY GAMES DEFAULTS TO 16. Under the convex
 * form this mean is dominated by rare large-gap years, so the estimate is far
 * noisier than the linear one was: WC read -0.0364 at 4 games and -0.0115 at 12
 * on the same seed family. A gate run thin here reports a drift the model does
 * not have.
 */
const MAX_DEFAULTS_DRIFT = 0.020;
/** The priced-up arm: fundingAtExpected off, confidence climbing to the cap. */
const RAMP_START = 0.60;
const RAMP_STEP = 0.035;
/** ONE STOP on the funding slider from where the game ships (Expected). */
const ONE_STOP = 0.65;
const DECISION_YEAR = 3;

/**
 * ⚠ THE RULING, AS A LIST. Every file in src/ that may touch `.satisfaction` on
 * a Member. Adding one is a decision about whether this stays a scoreboard.
 */
const ALLOWED: Record<string, string> = {
  'src/types/simulation.ts': 'the field declaration',
  'src/data/memberCatalog.ts': 'the roster\'s opening spread',
  'src/utils/memberSatisfaction.ts': 'the model itself',
  'src/utils/membershipEngine.ts': 'the enrolment draw, the one call that advances the stock — '
    + 'AND the retention weight below, which is a different quantity with the same name',
  'src/utils/memberDeparture.ts': 'PROSE ONLY — the header records why the old key was wrong',
  // ⚠ ADDED BECAUSE THIS GATE CAUGHT IT, AND THE RULING IS THAT IT IS NOT A
  // CONSUMER. memberValue.ts names Member.satisfaction only to CONTRAST the two
  // "feeds nothing" rulings: satisfaction's is "not yet, and here are the three
  // preconditions", while value's is permanent for anything acting on a member,
  // because the value ratio's measured test-retest correlation is zero. No value
  // function reads or writes the field. If that ever changes this entry is the
  // wrong one and the three preconditions apply.
  'src/utils/memberValue.ts': 'PROSE ONLY — its header contrasts the two feeds-nothing rulings',
  'src/pages/MembershipPage.tsx': 'the roster column and its sort',
  'src/utils/priorHistoryEngine.ts': 'the boundary re-pin — the stock does not carry the pre-game in',
  'src/utils/simulationEngine.ts': 'the post-charge satisfaction pass and the scored roster',
  'src/utils/gameSave.ts': 'memberSatisfactionMoves on SAVE_STRIPPED_KEYS — it never reaches a save',
  // ⚠ FOUND BY THIS GATE, NOT KNOWN BEFORE IT. The spreadsheet page carries a
  // per-member Satisfaction column AND a CSV export of it, and neither export
  // baseline covers that path — solo-export-guard hashes buildResultsWorkbook,
  // which has no per-member roster. So this is a player-facing export surface
  // that no baseline sees, which is also why both baselines held bit-identical
  // across the commit that made the field move.
  'src/pages/ResultSpreadsheetPage.tsx': 'a per-member column and its CSV — UNGATED BY EITHER BASELINE',
  // ⚠ A NAME COLLISION AND NOT A CONSUMER. MEMBER_MOVEMENT_WEIGHTS.retention
  // has a field literally called `satisfaction`; it weights the POOL-LEVEL
  // scalar into retention and never sees a Member. Allow-listed rather than
  // excluded by a cleverer regex, because the collision is real and the next
  // reader should be told it exists rather than have it filtered away.
  'src/data/defaultAssumptions.ts': 'MEMBER_MOVEMENT_WEIGHTS.retention.satisfaction — the POOL scalar\'s weight',
};

const failures: string[] = [];
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const sd = (v: number[]) => {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};
const q = (v: number[], p: number) => {
  const t = [...v].sort((a, b) => a - b);
  return t.length ? t[Math.min(t.length - 1, Math.max(0, Math.floor(p * t.length)))] : NaN;
};

interface LineYear {
  line: string; year: number; members: Member[]; moves: SatisfactionMove[];
}

/**
 * ⚠ THE MOVES ARE READ OFF THE RESULT, NOT RECOMPUTED, AND THE FIRST VERSION OF
 * THIS GATE RECOMPUTED THEM. processLineYear now carries
 * `memberSatisfactionMoves` — in-memory, stripped on save — precisely so this
 * gate can assert the signal the engine used rather than one like it. The
 * re-derivation read WC's drift at -0.0153 against an observed -0.0049 and
 * reversed GL's sign, because the engine's satisfaction pass runs on the CHARGED
 * rate and nothing else on the result carries the pre-movement quote. Two
 * sections used to carry a caveat about that; neither does now.
 */
function play(g: number, ramp: boolean): LineYear[] {
  const id = `MS${g}`;
  const instance = generateGameInstance(id, 61_000_000 + g * 6779);
  const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: LineYear[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y) as DecisionSet;
    if (ramp) {
      for (const l of LINES) {
        d.byLine[l].fundingAtExpected = false;
        d.byLine[l].fundingConfidenceLevel = Math.min(0.95, RAMP_START + RAMP_STEP * (y - 1));
      }
    }
    const p = processYear(gs, d);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    for (const lr of p.lineResults) {
      const x = lr.result as never as Record<string, unknown>;
      out.push({
        line: lr.line as string, year: y,
        members: x.memberList as Member[],
        moves: (x.memberSatisfactionMoves as SatisfactionMove[]) ?? [],
      });
    }
  }
  return out;
}

/** One stop on the funding slider, held from `from` on. The decision the
 *  scoreboard exists to make visible. */
function playDecision(g: number, from: number): LineYear[] {
  const id = `MS${g}`;
  const instance = generateGameInstance(id, 61_000_000 + g * 6779);
  const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: LineYear[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y) as DecisionSet;
    if (y >= from) {
      for (const l of LINES) { d.byLine[l].fundingAtExpected = false; d.byLine[l].fundingConfidenceLevel = ONE_STOP; }
    }
    const p = processYear(gs, d);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    for (const lr of p.lineResults) {
      const x = lr.result as never as Record<string, unknown>;
      out.push({
        line: lr.line as string, year: y,
        members: x.memberList as Member[],
        moves: (x.memberSatisfactionMoves as SatisfactionMove[]) ?? [],
      });
    }
  }
  return out;
}

console.log(RULE);
console.log('PER-MEMBER SATISFACTION — a scoreboard, and it has to move and feed nothing');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years. Change weight ${SATISFACTION.priceWeight} per squared pp, `
  + `level weight ${SATISFACTION.levelWeight} per pp at a ${SATISFACTION.levelHalfLifeYears}-year half-life, `
  + `stock clamped to [${SATISFACTION.floor}, ${SATISFACTION.ceiling}].\n`);

const baseline = Array.from({ length: GAMES }, (_, g) => play(g, false));
// ============================================================================
// ⚠ SOLVE MODE — SOLVE=1 RE-DERIVES THE TWO SURPLUS-LIMB CONSTANTS AND EXITS.
//
//   SOLVE=1 npx tsx scripts/diagnostics/member-satisfaction-check.ts
//
// It lives INSIDE the gate rather than beside it, and that is deliberate. Both
// constants are solved against measurements this file already makes — the median
// surplus ratio it bands in section 8(c), and the six-year footprint it measures
// in section 6. A separate solver would have to reimplement the footprint, and
// opening-pin-solve's own header records what that costs: "a pin solved against a
// different estimator than the one that asserts is a pin that fails its own
// gate." Solve through the gate's estimator.
//
// It changes nothing when unset.
// ============================================================================
if (process.env.SOLVE) {
  const solveBase = Array.from({ length: GAMES }, (_, g) => play(g, false));
  const med = (v: number[]) => { const t = [...v].sort((a, b) => a - b); const i = (t.length - 1) / 2;
    return t.length % 2 ? t[i] : (t[Math.floor(i)] + t[Math.ceil(i)]) / 2; };

  console.log(RULE);
  console.log(`SURPLUS-LIMB SOLVE — ${GAMES} games x ${YEARS} years at defaults`);
  console.log(RULE);

  // --- (1) surplusComfortable = the median of default play, on the lines that
  //     discriminate. Property is excluded BY THE RULE, not by convenience: its
  //     reserve-based denominator does not measure its catastrophe exposure, so
  //     its ratio runs a median near 5 and no boundary in range discriminates.
  console.log('\n--- 1. surplusComfortable — the median of default play ---');
  console.log('    line       n     p25      MEDIAN      p75     current boundary   share above');
  const ratiosBy: Record<string, number[]> = {};
  for (const run of solveBase) {
    for (const ly of run) {
      for (const mv of ly.moves) {
        if (mv.surplusRatio === null || !Number.isFinite(mv.surplusRatio)) continue;
        (ratiosBy[ly.line] ??= []).push(mv.surplusRatio);
      }
    }
  }
  const qq = (v: number[], p: number) => { const t = [...v].sort((a, b) => a - b);
    const i = (t.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? t[lo] : t[lo] + (t[hi] - t[lo]) * (i - lo); };
  const discriminating = ['WC', 'GL'];
  for (const l of LINES) {
    const v = ratiosBy[l] ?? [];
    if (!v.length) continue;
    const above = v.filter(x => x >= SATISFACTION.surplusComfortable).length / v.length;
    console.log(`    ${l.padEnd(9)}${String(v.length).padStart(6)}${qq(v, 0.25).toFixed(4).padStart(9)}`
      + `${med(v).toFixed(4).padStart(12)}${qq(v, 0.75).toFixed(4).padStart(9)}`
      + `${SATISFACTION.surplusComfortable.toFixed(4).padStart(19)}`
      + `${`${(100 * above).toFixed(1)}%`.padStart(13)}`
      + `${discriminating.includes(l) ? '' : '   (excluded from the rule)'}`);
  }
  const pooled = discriminating.flatMap(l => ratiosBy[l] ?? []);
  const solvedComfortable = med(pooled);
  console.log(`\n    THE RULE: the median of default play, POOLED over the lines that discriminate`);
  console.log(`    (WC and GL). Pooled n ${pooled.length}, median ${solvedComfortable.toFixed(4)}`);
  console.log(`    -> surplusComfortable: ${SATISFACTION.surplusComfortable.toFixed(4)} -> ${solvedComfortable.toFixed(4)}`);

  // --- (2) surplusWeight, bisected against the footprint AS IT NOW IS, holding
  //     the <=25% cancellation bound. The bound is a ruling and is not re-solved.
  console.log('\n--- 2. surplusWeight — bisected to the 25% cancellation bound ---');
  console.log('    Measured on the SOLVED boundary, because the cancellation depends on how many');
  console.log('    band steps a funding stop crosses and that depends on where the boundary sits.');
  const keepC = SATISFACTION.surplusComfortable;
  SATISFACTION.surplusComfortable = solvedComfortable;
  const through = DECISION_YEAR + 5;
  const footprintAt = (w: number) => {
    const keep = SATISFACTION.surplusWeight;
    SATISFACTION.surplusWeight = w;
    const base = Array.from({ length: GAMES }, (_, g) => play(g, false));
    const dec = Array.from({ length: GAMES }, (_, g) => playDecision(g, DECISION_YEAR));
    SATISFACTION.surplusWeight = keep;
    const fps: number[] = [];
    for (let g = 0; g < GAMES; g++) {
      const b = base[g].filter(x => x.line === 'WC').slice(0, through);
      const d = dec[g].filter(x => x.line === 'WC').slice(0, through);
      if (b.length < through || d.length < through) continue;
      fps.push(mean(d[through - 1].members.map(m => m.satisfaction))
        - mean(b[through - 1].members.map(m => m.satisfaction)));
    }
    return mean(fps);
  };
  const fp0 = footprintAt(0);
  console.log(`    footprint with the limb OFF: ${fp0.toFixed(4)} points, measured at year ${through} — `
    + `the decision year ${DECISION_YEAR} and the five after it, which is six years and not ${through}`);
  const TARGET = 0.25;
  let lo = 0, hi = 0.20, solvedW = 0;
  console.log('    pass     w        footprint   cancelled');
  for (let i = 0; i < 7; i++) {
    const w = (lo + hi) / 2;
    const fp = footprintAt(w);
    const cancelled = fp0 !== 0 ? 1 - Math.abs(fp) / Math.abs(fp0) : 0;
    console.log(`    ${String(i).padStart(4)}  ${w.toFixed(4)}   ${fp.toFixed(4).padStart(10)}`
      + `${`${(100 * cancelled).toFixed(1)}%`.padStart(12)}`);
    if (cancelled > TARGET) hi = w; else { lo = w; solvedW = w; }
  }
  SATISFACTION.surplusComfortable = keepC;
  console.log(`\n    -> surplusWeight: ${SATISFACTION.surplusWeight.toFixed(4)} -> ${solvedW.toFixed(4)}`);
  console.log(`    (largest w whose cancellation stays inside the ${(100 * TARGET).toFixed(0)}% bound)`);
  console.log(`\n${RULE}`);
  console.log('SOLVE ONLY — nothing written. Paste both into memberSatisfaction.ts by hand.');
  console.log(RULE);
  process.exit(0);
}


// --- 1. it moves ------------------------------------------------------------
console.log('--- 1. the field moves ---');
function movedShare(runs: LineYear[][], line: string): { moved: number; total: number; clamped: number } {
  let moved = 0, total = 0, clamped = 0;
  for (const run of runs) {
    const prev = new Map<string, number>();
    for (const ly of run.filter(r => r.line === line)) {
      for (const m of ly.members) {
        const was = prev.get(m.id);
        if (was !== undefined) { total++; if (was !== m.satisfaction) moved++; }
        if (m.satisfaction <= SATISFACTION.floor || m.satisfaction >= SATISFACTION.ceiling) clamped++;
        prev.set(m.id, m.satisfaction);
      }
    }
  }
  return { moved, total, clamped };
}
for (const line of LINES) {
  const s = movedShare(baseline, line);
  const share = s.moved / Math.max(s.total, 1);
  const ok = share >= MIN_MOVED_SHARE;
  console.log(`  ${line.padEnd(9)} ${s.moved}/${s.total} member-years moved (${(100 * share).toFixed(1)}%)   `
    + `at a clamp ${s.clamped}   ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) {
    failures.push(`${line}: only ${(100 * share).toFixed(1)}% of member-years moved, under the `
      + `${(100 * MIN_MOVED_SHARE).toFixed(0)}% floor. The field this replaced moved in 0.4% of them and `
      + `shipped that way for months — this is the assertion whose absence allowed it.`);
  }
}
{
  // The null arm. Weight 0 must freeze the field completely, which is also the
  // statement that every move above came from THIS mechanism and not from
  // members joining and drawing afresh.
  // ⚠ BOTH WEIGHTS, AND ZEROING ONLY THE CHANGE TERM WAS THE FIRST CUT'S BUG.
  // The model has two limbs now — a convex reaction to this year's gap and a
  // pull toward the anchor the standing price level implies — and a null that
  // silenced one of them reported 85.7% of member-years still moving, which is
  // the anchor doing exactly what it should. A null arm has to switch off the
  // whole mechanism or the share it measures is not this mechanism's.
  // ⚠ ALL FOUR WEIGHTS, AND THIS GATE WENT RED THE DAY THE THIRD AND FOURTH
  // LIMBS SHIPPED BECAUSE IT ONLY ZEROED TWO. A null arm that leaves half the
  // model running measures the half it left running, and reported 88% of
  // member-years moving "with the weight at 0". Every weight this mechanism has
  // must be listed here; if a fifth limb lands, it goes in this list first.
  const keepPrice = SATISFACTION.priceWeight;
  const keepLevel = SATISFACTION.levelWeight;
  const keepLoss = SATISFACTION.lossLevelWeight;
  const keepSurplus = SATISFACTION.surplusWeight;
  const keepAmp = SATISFACTION.lossAmplifierSlope;
  SATISFACTION.priceWeight = 0;
  SATISFACTION.levelWeight = 0;
  SATISFACTION.lossLevelWeight = 0;
  SATISFACTION.surplusWeight = 0;
  SATISFACTION.lossAmplifierSlope = 0;
  const nullRuns = Array.from({ length: Math.min(3, GAMES) }, (_, g) => play(g, false));
  SATISFACTION.priceWeight = keepPrice;
  SATISFACTION.levelWeight = keepLevel;
  SATISFACTION.lossLevelWeight = keepLoss;
  SATISFACTION.surplusWeight = keepSurplus;
  SATISFACTION.lossAmplifierSlope = keepAmp;
  let moved = 0, total = 0;
  for (const line of LINES) { const s = movedShare(nullRuns, line); moved += s.moved; total += s.total; }
  const share = moved / Math.max(total, 1);
  const ok = share <= MAX_NULL_SHARE;
  console.log(`  null arm (weight 0): ${moved}/${total} member-years moved (${(100 * share).toFixed(2)}%)  ${ok ? 'OK' : 'FAIL'}`);
  console.log('    ⚠ NOT ZERO, AND THE RESIDUE IS THE POINT. A member who withdraws and re-enrols');
  console.log('      draws a fresh U(6.0, 8.5) at join, so the field moves for them even with the');
  console.log('      mechanism switched off. That residue is the ENTIRETY of what the frozen field');
  console.log('      this replaced ever did — 70 moves in 18,239 member-year pairs, 0.4% — which is');
  console.log('      why section 1 asserts a SHARE rather than "not constant".');
  if (!ok) {
    failures.push(`${(100 * share).toFixed(2)}% of member-years moved with the weight at 0, past the `
      + `${(100 * MAX_NULL_SHARE).toFixed(0)}% re-join allowance. Something other than the price term and `
      + `the enrolment draw is writing Member.satisfaction, so section 1's share is not measuring this `
      + `mechanism.`);
  }
}

// --- 2. it feeds nothing ----------------------------------------------------
console.log('\n--- 2. nothing reads it (static) ---');
{
  const roots = ['src'];
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      const body = readFileSync(p, 'utf8');
      // Three things, because the ruling is about the MECHANISM and not only
      // about the field name:
      //   `.satisfaction` on a value, and `satisfaction:` in an object literal
      //     or type. The lookbehind is on `satisfaction` itself and excludes
      //     `memberSatisfaction`, which is the POOL-LEVEL scalar and a different
      //     quantity — see memberSatisfaction.ts's seam note.
      //   the model's own exports, so a file that calls satisfactionMoves or
      //     applySatisfaction without touching the field is still caught.
      //   `memberSatisfactionMoves`, the result key that carries the per-member
      //     reaction. A consumer of THAT is a consumer of this mechanic and the
      //     first two patterns would miss it entirely.
      //
      // ⚠ THE FIRST CUT PUT THE LOOKBEHIND BEFORE THE DOT, which tested the
      // character before `.` rather than before `satisfaction` — so
      // `member.satisfaction` was EXCLUDED and MembershipPage, the field's
      // whole reason for existing, read as not touching it. A static allow-list
      // whose matcher misses the real consumers is worse than none: it reports
      // a clean surface it never looked at.
      if (/(?<![A-Za-z])satisfaction\s*:/.test(body)
        || /\.satisfaction\b/.test(body)
        || /\b(satisfactionMoves|applySatisfaction|satisfactionReaction|memberSatisfactionMoves)\b/.test(body)) {
        hits.push(p.replace(/\\/g, '/'));
      }
    }
  };
  for (const r of roots) walk(r);
  const unexpected = hits.filter(h => !(h in ALLOWED));
  const missing = Object.keys(ALLOWED).filter(a => !hits.includes(a));
  for (const h of hits.sort()) console.log(`  ${h.padEnd(40)} ${ALLOWED[h] ?? '*** NOT ON THE ALLOW-LIST ***'}`);
  if (unexpected.length > 0) {
    failures.push(`Member.satisfaction is touched by ${unexpected.join(', ')}, which is not on the `
      + `allow-list. It is a SCOREBOARD: if this is a new consumer, read memberSatisfaction.ts's three `
      + `preconditions before adding the file here, because a consumer makes it a mechanic.`);
  }
  if (missing.length > 0) {
    console.log(`  ⚠ allow-listed but no longer matching: ${missing.join(', ')}`);
    failures.push(`the allow-list names ${missing.join(', ')}, which no longer touches the field. `
      + `A stale allow-list is a list nobody trusts; remove the entry.`);
  }
  console.log(`  ${hits.length} files, ${unexpected.length} unexpected  ${unexpected.length === 0 && missing.length === 0 ? 'OK' : 'FAIL'}`);
}

// --- 3. drift at defaults ---------------------------------------------------
console.log('\n--- 3. drift at defaults ---');
console.log('  MEASURED ON THE SHIPPED SERIES: each member\'s year-over-year change in the');
console.log('  stored field, on members present in both years. The engine\'s own per-member');
console.log('  moves are read off the result for the decomposition, so nothing here is');
console.log('  re-derived and nothing carries a caveat.');
for (const line of LINES) {
  const deltas: number[] = [];
  for (const run of baseline) {
    const prev = new Map<string, number>();
    for (const ly of run.filter(r => r.line === line)) {
      for (const m of ly.members) {
        const was = prev.get(m.id);
        if (was !== undefined) deltas.push(m.satisfaction - was);
        prev.set(m.id, m.satisfaction);
      }
    }
  }
  const m = mean(deltas);
  const se = sd(deltas) / Math.sqrt(deltas.length);
  const ok = Math.abs(m) <= MAX_DEFAULTS_DRIFT;
  console.log(`  ${line.padEnd(9)} observed drift ${m >= 0 ? '+' : ''}${m.toFixed(4)} +/- ${se.toFixed(4)} pts/member-yr   `
    + `over ${YEARS} years ${(m * YEARS >= 0 ? '+' : '')}${(m * YEARS).toFixed(3)} pts   ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) {
    failures.push(`${line}: satisfaction drifts ${m.toFixed(4)} points per member-year AT DEFAULTS, `
      + `past the ${MAX_DEFAULTS_DRIFT} bound. All-defaults is this model's neutral point; a scoreboard `
      + `that slides there is reporting its own calibration error as a player's result, and it is `
      + `precondition 3 against ever promoting this field into departure. Check the sample first — `
      + `this mean is tail-dominated under a convex reaction and is noisy below about 12 games.`);
  }
}
console.log('  the gap the drift is built from, exact:');
for (const line of LINES) {
  const rows = baseline.flatMap(r => r.filter(x => x.line === line).flatMap(x => x.moves));
  const gaps = rows.map(m => m.excessPct);
  const abs = gaps.map(Math.abs).sort((a, b) => a - b);
  console.log(`    ${line.padEnd(9)} gap mean ${mean(gaps).toFixed(2)}pp  median ${abs[Math.floor(0.5 * abs.length)].toFixed(2)}|pp|  `
    + `p90 ${abs[Math.floor(0.9 * abs.length)].toFixed(2)}|pp|  SD ${sd(gaps).toFixed(2)}pp   `
    + `own-modifier change mean ${mean(rows.map(m => m.ownChangePct)).toFixed(2)}pp `
    + `SD ${sd(rows.map(m => m.ownChangePct)).toFixed(2)}pp (IN THE BILL, NOT IN THE GAP)`);
}

// --- 4. the reaction is convex ----------------------------------------------
console.log('\n--- 4. the reaction is convex, against the linear form it replaces ---');
{
  // The linear form's scale, so the two are compared at the same anchor rather
  // than at two arbitrary levels. W_lin is set so both agree at the crossover,
  // which is where the convex coefficient was derived: K x g^2 = W_lin x g at
  // g = W_lin / K.
  const crossover = SATISFACTION.linearEquivalent / SATISFACTION.priceWeight;
  console.log(`  crossover (where convex = linear) ${crossover.toFixed(2)}pp  `
    + `— the gap a typical year carrying one funding stop produces`);
  console.log('    gap      convex     linear    ratio');
  let monotone = true, prevRatio = -Infinity;
  for (const g of [1.5, 3, 5, crossover, 13, 20]) {
    const c = SATISFACTION.priceWeight * satisfactionReaction(g);
    const l = SATISFACTION.linearEquivalent * g;
    const ratio = c / l;
    if (ratio < prevRatio - 1e-12) monotone = false;
    prevRatio = ratio;
    console.log(`    ${g.toFixed(2).padStart(6)}pp  ${c.toFixed(4).padStart(8)}  ${l.toFixed(4).padStart(9)}   ${ratio.toFixed(2).padStart(6)}x`);
  }
  if (!monotone) {
    failures.push('the convex/linear ratio is not monotone in the gap. A convex reaction must grow '
      + 'faster than the gap everywhere, or "ordinary years go quiet, decisions bite" is not what it does.');
  }
  // The asymmetry, at the same magnitude either way.
  const up = satisfactionReaction(10), down = satisfactionReaction(-10);
  const lam = up / -down;
  const lamOk = Math.abs(lam - SATISFACTION.gratitudeLambda) < 1e-9;
  console.log(`  asymmetry: +10pp reacts ${up.toFixed(2)}, -10pp reacts ${down.toFixed(2)}, ratio ${lam.toFixed(3)} `
    + `against gratitudeLambda ${SATISFACTION.gratitudeLambda}  ${lamOk ? 'OK' : 'FAIL'}`);
  if (!lamOk) failures.push(`the reaction's up/down ratio is ${lam.toFixed(3)}, not gratitudeLambda.`);
  // And the thing the rebuild is FOR: the decision's SHARE of the year it lands
  // in. Form-determined, not weight-determined — the same at any K, which is why
  // it is the number worth printing.
  const ordinary = mean(baseline.flatMap(r => r.flatMap(x => x.moves.map(m => Math.abs(m.excessPct)))));
  const convexShare = (satisfactionReaction(crossover) - satisfactionReaction(ordinary))
    / satisfactionReaction(crossover);
  const linearShare = (crossover - ordinary) / crossover;
  console.log(`  a year carrying a typical gap (${ordinary.toFixed(2)}pp) AND one funding stop: the decision is`);
  console.log(`    ${(100 * linearShare).toFixed(0)}% of the member's move under the linear form, `
    + `${(100 * convexShare).toFixed(0)}% under this one`);
  if (!(convexShare > linearShare)) {
    failures.push('the decision\'s share of a decision year is no larger under the convex form than '
      + 'under the linear one. That share is the whole purpose of the rebuild.');
  }
}

// --- 5. the member's own experience cannot move their satisfaction ----------
console.log('\n--- 5. the own-MODIFIER price channel stays out, and the ruling narrowed ---');
console.log('  ⚠ THIS SECTION ASSERTED SOMETHING STRONGER UNTIL THE LOSS-RATIO LIMB SHIPPED, AND');
console.log('  THE OLD ASSERTION IS NOW FALSE BY DESIGN. It required every member of a line-year');
console.log('  to take an IDENTICAL delta. The price amplifier deliberately breaks that: a member');
console.log('  with a good loss ratio minds a rise above market MORE, a heavy-claims member LESS.');
console.log('');
console.log('  WHAT SURVIVES IS THE HALF THAT WAS ALWAYS THE REAL RULE, and the two are different');
console.log('  channels however correlated they look. The member\'s own MODIFIER must not change');
console.log('  what they are COMPARED AGAINST — excessPct is the pool\'s rate against the market,');
console.log('  one number for the whole line-year, and it stays that way. Their own LOSS RATIO may');
console.log('  change how hard they REACT to it. A bill that rose because of your own rating is');
console.log('  still not the pool\'s doing; how much you mind the pool\'s doing is your own.');
{
  let groups = 0, worstDelta = 0, worstModSpread = 0, thinGroups = 0;
  for (const run of baseline) {
    for (const ly of run) {
      if (ly.moves.length < 2) continue;
      const deltas = ly.moves.map(m => m.excessPct);
      const mods = ly.moves.map(m => m.ownChangePct);
      const dSpread = Math.max(...deltas) - Math.min(...deltas);
      const mSpread = Math.max(...mods) - Math.min(...mods);
      // ⚠ THE TEST HAS TEETH ONLY WHERE THE MODIFIERS ACTUALLY DIFFER. A
      // line-year in which every member's modifier moved identically would pass
      // whatever the model did with it, so those are counted and excluded.
      if (mSpread < 1) { thinGroups++; continue; }
      groups++;
      worstDelta = Math.max(worstDelta, dSpread);
      worstModSpread = Math.max(worstModSpread, mSpread);
    }
  }
  console.log(`  ${groups} line-years with a modifier spread over 1pp (${thinGroups} too flat to test)`);
  console.log(`  widest own-modifier spread inside a line-year: ${worstModSpread.toFixed(2)}pp`);
  console.log(`  widest GAP (excessPct) spread inside a line-year: ${worstDelta.toExponential(2)} pp`);
  const ok = groups >= 100 && worstDelta <= 1e-12;
  console.log(`  the gap is identical regardless of own experience: ${ok ? 'OK' : 'FAIL'}`);
  if (groups < 100) {
    failures.push(`only ${groups} line-years had members whose own modifiers moved differently by more `
      + `than 1pp, so section 5 barely tested anything. Raise GAMES.`);
  } else if (worstDelta > 1e-12) {
    failures.push(`inside one line-year, members were judged against gaps differing by `
      + `${worstDelta.toExponential(2)}pp while their own modifier changes spread `
      + `${worstModSpread.toFixed(2)}pp. The gap is the POOL's rate against the market — one decision, one `
      + `number for the line-year. The own-modifier price channel is ruled out and something is letting `
      + `it back into what the member is compared against.`);
  }

  // ⚠ AND THE OTHER HALF, BECAUSE A CONSTANCY TEST PASSES TRIVIALLY IF THE THING
  // IT GROUPS ON IS CONSTANT FOR AN UNRELATED REASON. The amplifier must MOVE,
  // it must be centred on 1 across the book, and it must be driven by the loss
  // ratio rather than by the modifier.
  {
    let ampSpread = 0, worstMean = 0, n = 0;
    const amps: number[] = [], us: number[] = [], modChanges: number[] = [];
    for (const run of baseline) {
      for (const ly of run) {
        if (ly.moves.length < 2) continue;
        const a = ly.moves.map(m => m.priceAmplifier);
        ampSpread = Math.max(ampSpread, Math.max(...a) - Math.min(...a));
        worstMean = Math.max(worstMean, Math.abs(mean(a) - 1));
        n++;
        for (const m of ly.moves) { amps.push(m.priceAmplifier); us.push(m.lossStanding); modChanges.push(m.ownChangePct); }
      }
    }
    const corr = (x: number[], y: number[]) => {
      const mx = mean(x), my = mean(y);
      let p = 0, dx = 0, dy = 0;
      for (let i = 0; i < x.length; i++) { p += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
      return dx > 0 && dy > 0 ? p / Math.sqrt(dx * dy) : 0;
    };
    console.log(`  AMPLIFIER: widest spread inside a line-year ${ampSpread.toFixed(3)}, worst |book mean - 1| `
      + `${worstMean.toExponential(2)} over ${n} line-years`);
    console.log(`  corr(amplifier, loss standing) ${corr(amps, us).toFixed(3)}   `
      + `corr(amplifier, own modifier change) ${corr(amps, modChanges).toFixed(3)}`);
    if (!(ampSpread > 0.05)) {
      failures.push(`the price amplifier spreads only ${ampSpread.toFixed(3)} inside a line-year. Term 3 is `
        + `the only per-member channel satisfaction has; if it does not move, the gap assertion above `
        + `passes on a flat sample and the term is not there.`);
    }
    if (!(worstMean < 1e-9)) {
      failures.push(`the amplifier's book mean differs from 1 by ${worstMean.toExponential(2)}. It is rebased `
        + `so the LINE's mean reaction is unchanged — an unrebased amplifier silently retunes the change `
        + `limb for everyone and would show up as drift nobody chose.`);
    }
    if (!(corr(amps, us) > 0.9)) {
      failures.push(`the amplifier correlates ${corr(amps, us).toFixed(3)} with the loss standing it is `
        + `defined from. It must be that standing and nothing else.`);
    }
  }
}
{
  // ⚠ POSITIVE CONTROL, AND SECTION 5 NEEDS ONE MORE THAN MOST. A constancy test
  // passes trivially if the quantity it groups on is constant for an unrelated
  // reason, so the control puts the member's own modifier change BACK into the
  // gap and requires the test to fail.
  let worst = 0, groups = 0;
  for (const run of baseline) {
    for (const ly of run) {
      if (ly.moves.length < 2) continue;
      const mods = ly.moves.map(m => m.ownChangePct);
      if (Math.max(...mods) - Math.min(...mods) < 1) continue;
      groups++;
      const contaminated = ly.moves.map(m => -SATISFACTION.priceWeight
        * satisfactionReaction(m.excessPct + m.ownChangePct));
      worst = Math.max(worst, Math.max(...contaminated) - Math.min(...contaminated));
    }
  }
  const fired = worst > 1e-12;
  console.log(`  control: the same test with the modifier put BACK into the gap spreads `
    + `${worst.toFixed(4)} points over ${groups} line-years  ${fired ? 'RED (correct)' : 'still flat'}`);
  if (!fired) {
    failures.push('the control could not make section 5 fail even with the member\'s own modifier '
      + 'change added straight back into the gap. A constancy test that cannot be broken is not a test.');
  }
}

// --- 6. one member, one decision --------------------------------------------
console.log(`\n--- 6. one blameless member, one stop on the funding slider in year ${DECISION_YEAR} ---`);
{
  const decided = Array.from({ length: GAMES }, (_, g) => playDecision(g, DECISION_YEAR));
  const through = DECISION_YEAR + 5;
  const footprints: number[] = [];
  let printed = 0;
  for (let g = 0; g < GAMES; g++) {
    const b = baseline[g].filter(x => x.line === 'WC').slice(0, through);
    const d = decided[g].filter(x => x.line === 'WC').slice(0, through);
    if (b.length < through || d.length < through) continue;
    const present = (rows: LineYear[], id: string) => rows.every(r => r.members.some(m => m.id === id));
    // ⚠ "BLAMELESS" NO LONGER MEANS ANYTHING TO THE MODEL AND THE FILTER STAYS
    // ANYWAY. With the fault term retired every member of a line-year takes the
    // same delta, so any member would trace the same path. Holding the member's
    // own modifier close to flat keeps the BILL column in the trace readable —
    // it is a display choice now, not a selection the mechanism cares about.
    const blameless = (rows: LineYear[], id: string) => rows
      .slice(DECISION_YEAR - 1)
      .every(r => Math.abs(r.moves.find(m => m.memberId === id)?.ownChangePct ?? 0) <= 3);
    const cand = b[through - 1].members.map(m => m.id)
      .filter(id => present(b, id) && present(d, id) && blameless(b, id));
    if (cand.length === 0) continue;
    const id = cand[0];
    const satOf = (rows: LineYear[]) => rows.map(r => ({
      y: r.year,
      sat: rows === b || rows === d ? r.members.find(x => x.id === id)!.satisfaction : 0,
      gap: r.moves.find(x => x.memberId === id)?.excessPct ?? 0,
      delta: r.moves.find(x => x.memberId === id)?.delta ?? 0,
    }));
    const B = satOf(b), D = satOf(d);
    footprints.push(D[through - 1].sat - B[through - 1].sat);
    if (printed === 0) {
      console.log(`  game ${g}, member ${id} — WC, present and blameless throughout`);
      console.log('    yr |  left alone: gap    delta     sat |  one stop: gap    delta     sat |  difference');
      for (let i = 0; i < B.length; i++) {
        console.log(`    ${String(B[i].y).padStart(2)} | ${B[i].gap.toFixed(2).padStart(17)} ${B[i].delta.toFixed(4).padStart(8)} ${B[i].sat.toFixed(2).padStart(7)} |`
          + ` ${D[i].gap.toFixed(2).padStart(14)} ${D[i].delta.toFixed(4).padStart(8)} ${D[i].sat.toFixed(2).padStart(7)} |`
          + ` ${(D[i].sat - B[i].sat).toFixed(2).padStart(11)}`);
      }
      printed++;
    }
  }
  const fp = mean(footprints);
  console.log(`  FOOTPRINT over the decision year and the five after it, ${footprints.length} games: `
    + `${fp.toFixed(3)} points (SD across games ${sd(footprints).toFixed(3)})`);
  // ⚠ SPLIT INTO ITS TWO LIMBS, AND ASSERTED, BECAUSE THE RATIO WENT STALE ONCE
  // ALREADY. levelWeight was derived against a change-limb figure measured
  // BEFORE the anchor existed — see the constant — and nothing checked the split
  // afterwards. The level limb's contribution is computable exactly from the
  // rows: the two arms' anchors differ by a known amount and the stock closes
  // 1 - 0.5^(years/halfLife) of that distance. The change limb is the residual.
  {
    const conv = 1 - Math.pow(0.5, (through - DECISION_YEAR + 1) / SATISFACTION.levelHalfLifeYears);
    const anchorGaps: number[] = [];
    for (let g = 0; g < GAMES; g++) {
      const b = baseline[g].filter(x => x.line === 'WC').slice(DECISION_YEAR - 1, through);
      const d = decided[g].filter(x => x.line === 'WC').slice(DECISION_YEAR - 1, through);
      if (!b.length || !d.length) continue;
      anchorGaps.push(mean(d.map(r => r.moves[0]?.anchor ?? 0)) - mean(b.map(r => r.moves[0]?.anchor ?? 0)));
    }
    const levelLimb = mean(anchorGaps) * conv;
    const changeLimb = fp - levelLimb;
    console.log(`  SPLIT: level limb ${levelLimb.toFixed(4)} (anchor gap ${mean(anchorGaps).toFixed(4)} x `
      + `${(100 * conv).toFixed(0)}% convergence), change limb ${changeLimb.toFixed(4)} — `
      + `ratio ${Math.abs(levelLimb / (changeLimb || 1e-9)).toFixed(1)}:1`);
    const ok = Math.abs(levelLimb) > Math.abs(changeLimb);
    console.log(`  the level limb is the larger of the two: ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) {
      failures.push(`the level limb contributes ${levelLimb.toFixed(4)} against the change limb's `
        + `${changeLimb.toFixed(4)} for a SUSTAINED decision. A gap that applies every year must outweigh `
        + `one that applies once — that is the whole reason the two limbs carry separate weights. See `
        + `SATISFACTION.levelWeight, whose derivation this replaced after it went stale.`);
    }
  }
  // ⚠ THE CANCELLATION BOUND, ASSERTED. surplusWeight's own derivation is a
  // BOUND rather than a match — this term may not cancel more than a quarter of
  // the funding decision it responds to — and that constant was wrong twice by
  // arithmetic before it was solved from this measurement. So the measurement is
  // the gate, not the arithmetic.
  //
  // ⚠ AND BOTH SIDES OF THE RATIO ARE THE LINE MEAN, WHICH THEY WERE NOT UNTIL
  // THE WEIGHT WAS RE-SOLVED. This block used to divide `fp` — the mean across
  // games of ONE selected member's six-year delta, the figure the trace above
  // prints — by a limb-off footprint measured as the mean across games of the
  // LINE-MEAN delta. Two different estimators, and the mismatch ran lenient:
  // at the then-shipped weight the mixed ratio read 11% where the matched one
  // reads 12.9%. opening-pin-solve's header states the rule this broke — "a pin
  // solved against a different estimator than the one that asserts is a pin that
  // fails its own gate" — and the SOLVE mode below bisects on the line mean, so
  // this is the side that had to move. The single-member figure stays in the
  // TRACE, where it is a display of one member's path; the BOUND is about the
  // decision's footprint on the membership, which is the population quantity and
  // the lower-variance one. Fixing it is not a relaxation: the superseded weight
  // passes under both readings, 11% and 12.9%, and the check below is stricter
  // than the one it replaces.
  {
    const keep = SATISFACTION.surplusWeight;
    const lineMeanFootprint = (rows: LineYear[][], base: LineYear[][]) => {
      const out: number[] = [];
      for (let g = 0; g < GAMES; g++) {
        const b = base[g].filter(x => x.line === 'WC').slice(0, through);
        const d = rows[g].filter(x => x.line === 'WC').slice(0, through);
        if (b.length < through || d.length < through) continue;
        out.push(mean(d[through - 1].members.map(m => m.satisfaction))
          - mean(b[through - 1].members.map(m => m.satisfaction)));
      }
      return mean(out);
    };
    const fpShipped = lineMeanFootprint(decided, baseline);
    SATISFACTION.surplusWeight = 0;
    const noSurplus = Array.from({ length: GAMES }, (_, g) => playDecision(g, DECISION_YEAR));
    const noBase = Array.from({ length: GAMES }, (_, g) => play(g, false));
    SATISFACTION.surplusWeight = keep;
    const fp0 = lineMeanFootprint(noSurplus, noBase);
    const cancelled = fp0 !== 0 ? 1 - Math.abs(fpShipped) / Math.abs(fp0) : 0;
    console.log(`  CANCELLATION, line mean on both sides: the same decision with surplusWeight at 0 reads `
      + `${fp0.toFixed(4)}, against ${fpShipped.toFixed(4)} shipped — the surplus limb cancels `
      + `${(100 * cancelled).toFixed(1)}% of it`);
    console.log(`    (the trace above follows ONE member, ${fp.toFixed(4)}; the bound is about the line)`);
    const okCancel = cancelled <= 0.25 + 1e-9;
    console.log(`  the surplus limb cancels at most a quarter of the funding decision: ${okCancel ? 'OK' : 'FAIL'}`);
    if (!okCancel) {
      failures.push(`the surplus limb cancels ${(100 * cancelled).toFixed(0)}% of the funding decision's `
        + `footprint, past the quarter SATISFACTION.surplusWeight is derived from. Funding is what BUILDS `
        + `surplus, so these two limbs pull against each other on the player's main lever by construction: `
        + `every point of weight this term carries comes straight out of that lever. Re-solve the weight `
        + `from this measurement rather than relaxing the bound.`);
    }
  }
  console.log(`  ENROLMENT LUCK, for scale: the opening draw spans `
    + `${(OPENING_SATISFACTION.max - OPENING_SATISFACTION.min).toFixed(2)} points end to end.`);
  const wide = Math.abs(fp) > (OPENING_SATISFACTION.max - OPENING_SATISFACTION.min);
  console.log(`  one decision outweighs enrolment luck: ${wide ? 'OK' : 'FAIL'}`);
  if (footprints.length < 3) {
    failures.push(`only ${footprints.length} games produced a blameless member present in both arms `
      + `for ${through} years, so section 6 has almost no sample. Raise GAMES.`);
  } else if (!wide) {
    failures.push(`one stop on the funding slider moves a blameless member ${fp.toFixed(3)} points over six `
      + `years, against an enrolment draw spanning `
      + `${(OPENING_SATISFACTION.max - OPENING_SATISFACTION.min).toFixed(2)}. The draw is the one part of this `
      + `model a player cannot influence, and it must not be able to hide a decision — that is the rule `
      + `OPENING_SATISFACTION's width is derived from, so either the width or the weight is wrong.`);
  }
}

// --- 7. positive control ----------------------------------------------------
console.log('\n--- 7. positive control: seed-matched, priced above the market ---');
{
  const diffs: number[] = [];
  for (let g = 0; g < GAMES; g++) {
    const a = baseline[g], b = play(g, true);
    const last = (runs: LineYear[]) => {
      const w = runs.filter(x => x.line === 'WC');
      return mean(w[w.length - 1].members.map(m => m.satisfaction));
    };
    diffs.push(last(b) - last(a));
  }
  const m = mean(diffs);
  const t = Math.abs(m / (sd(diffs) / Math.sqrt(diffs.length)));
  const ok = m < 0 && t >= 3;
  console.log(`  WC year-${YEARS} mean satisfaction, priced-up minus defaults: ${m.toFixed(4)}  paired t ${t.toFixed(1)}  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`  (the arm ramps fundingConfidenceLevel ${RAMP_START} -> `
    + `${Math.min(0.95, RAMP_START + RAMP_STEP * (YEARS - 1)).toFixed(3)} with fundingAtExpected off)`);
  if (!ok) {
    failures.push(`a pool priced above the market for ${YEARS} years ended ${m.toFixed(4)} points `
      + `${m < 0 ? 'lower' : 'HIGHER'} at t ${t.toFixed(1)}. It must end lower, and detectably. `
      + `A satisfaction model that does not respond to price is the frozen field again with more `
      + `arithmetic in front of it.`);
  }
}

// --- 8. the two new limbs carry their own derivations -----------------------
console.log('\n--- 8. term 3\'s spread and term 4\'s bands, against their own derivations ---');
{
  // (a) THE lossLevelWeight DERIVATION, ASSERTED. The rule is that the spread
  // this term creates across a book is worth about what ONE STOP on the funding
  // slider is worth through the market level: 0.030 x 3.85pp = 0.116 points.
  // The constant shipped WRONG on the day it was written — 0.45 produced 0.069
  // against that target — and this is what caught it.
  const TARGET = SATISFACTION.levelWeight * 3.85;
  console.log(`  (a) TERM 3's SPREAD. Target = one funding stop through the market level = `
    + `${TARGET.toFixed(4)} points.`);
  console.log('  line      within-line-year anchor SD   ratio to target   amplifier SD');
  let worstOff = 0;
  for (const line of LINES) {
    const rows = baseline.flatMap(r => r.filter(x => x.line === line)).filter(r => r.moves.length > 1);
    const aSD = mean(rows.map(r => sd(r.moves.map(m => m.anchor))));
    const ampSD = mean(rows.map(r => sd(r.moves.map(m => m.priceAmplifier))));
    worstOff = Math.max(worstOff, Math.abs(aSD / TARGET - 1));
    console.log(`  ${line.padEnd(9)} ${aSD.toFixed(4).padStart(26)}   ${(aSD / TARGET).toFixed(2).padStart(15)}   ${ampSD.toFixed(4).padStart(12)}`);
  }
  const okSpread = worstOff <= 0.35;
  console.log(`  the realised spread matches the derivation within 35%: ${okSpread ? 'OK' : 'FAIL'}`);
  if (!okSpread) {
    failures.push(`term 3's within-line-year anchor SD is ${(100 * worstOff).toFixed(0)}% away from the `
      + `${TARGET.toFixed(4)} its weight is derived against. SATISFACTION.lossLevelWeight states that rule; `
      + `either the weight or the rule is now wrong, and the weight was already wrong once this way.`);
  }

  // (b) THE UNCAPPED RATIO IS UNCAPPED, AND THE REACTION IS BOUNDED ANYWAY.
  // Both halves matter: if the ratio stops being heavy-tailed the saturation is
  // solving a problem that went away, and if the reaction stops being bounded
  // one claim moves a small member's whole opinion.
  console.log('  (b) THE UNCAPPED RATIO, and the bounded reaction taken from it.');
  console.log('  line      ratio p50   ratio MAX    u min     u max     level SD');
  let worstU = 0, thinnest = Infinity;
  for (const line of LINES) {
    const mv = baseline.flatMap(r => r.filter(x => x.line === line)).flatMap(r => r.moves);
    const rr = mv.map(m => m.lossRatio), uu = mv.map(m => m.lossStanding);
    worstU = Math.max(worstU, Math.max(...uu.map(Math.abs)));
    thinnest = Math.min(thinnest, Math.max(...rr));
    console.log(`  ${line.padEnd(9)} ${q(rr, 0.5).toFixed(3).padStart(9)}   ${Math.max(...rr).toFixed(1).padStart(9)}   `
      + `${Math.min(...uu).toFixed(3).padStart(7)}   ${Math.max(...uu).toFixed(3).padStart(7)}   `
      + `${sd(mv.map(m => m.lossLevel)).toFixed(4).padStart(8)}`);
  }
  if (!(worstU <= 1)) {
    failures.push(`the loss standing reached ${worstU.toFixed(3)}, outside [-1, 1]. tanh cannot do that; `
      + `the reaction is no longer bounded and one claim can move a small member's whole opinion.`);
  }
  if (!(thinnest > 20)) {
    failures.push(`the heaviest loss ratio in the sample is only ${thinnest.toFixed(1)}x the book. The `
      + `saturation scale exists because this quantity is heavy-tailed — measured to 159x, 158x and 203x `
      + `by line — and if it no longer is, lossSaturation is solving a problem that went away.`);
  }

  // (c) TERM 4'S BANDS, AND PROPERTY'S SATURATION NAMED RATHER THAN DISCOVERED.
  console.log('  (c) TERM 4\'s BANDS at defaults, share of member-years:');
  const BANDS = ['Deficient', 'Thin', 'Adequate', 'Strong', 'Unknown'] as const;
  let moved = 0;
  for (const line of LINES) {
    const mv = baseline.flatMap(r => r.filter(x => x.line === line)).flatMap(r => r.moves);
    const sh = (b: string) => mv.filter(m => m.surplusBand === b).length / mv.length;
    console.log(`  ${line.padEnd(9)} ` + BANDS.map(b => `${b} ${(100 * sh(b)).toFixed(1)}%`).join('   '));
    if (line !== 'Property') moved = Math.max(moved, 1 - Math.max(...BANDS.map(sh)));
  }
  const okBands = moved >= 0.30;
  console.log(`  on WC and GL the band is not saturated (>=30% outside its commonest band): ${okBands ? 'OK' : 'FAIL'}`);
  if (!okBands) {
    failures.push(`the surplus band sits in one bucket for more than 70% of member-years on WC and GL. `
      + `SATISFACTION.surplusComfortable is derived at the median of default play to avoid exactly this, `
      + `and a band that holds nine member-years in ten reports nothing about the player. THIS FIRES FROM `
      + `EITHER SIDE and the direction tells you which: a boundary far BELOW default play saturates into `
      + `"Strong" (the shipped capitalAdequacyStatus 0.25 did that once, 89.6% / 75.8% / 96.7% of `
      + `line-years, on a book with a growing premium base), and a boundary far ABOVE it saturates into `
      + `"Adequate" and below (1.15 was heading there — 10.9% of WC member-years reached it — once the `
      + `roster freeze and NO_NEW_BUSINESS collapsed the excess against an accumulating reserve margin). `
      + `Re-solve the boundary with SOLVE=1; do not widen this assertion.`);
  }
  console.log('  ⚠ PROPERTY IS EXPECTED TO SATURATE AND IS EXCLUDED FROM THAT ASSERTION ON PURPOSE.');
  console.log('    reserveRiskMarginNeeded is a RESERVE risk margin; Property is short-tail so its reserves');
  console.log('    are small, its ratio runs a median 4.96, and its real exposure is a $75M catastrophe this');
  console.log('    denominator does not measure. The term is near-constant there, and that is a property of');
  console.log('    the measure rather than of the pool.');
}

console.log('\n' + RULE);
if (failures.length === 0) {
  console.log('MEMBER SATISFACTION HOLDS.');
  console.log(RULE);
  process.exit(0);
}
console.log(`${failures.length} FAILURE(S):`);
for (const f of failures) console.log(`  - ${f}`);
console.log(RULE);
process.exit(1);
