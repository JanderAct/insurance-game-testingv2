// ============================================================================
// APPLICATION RATE DERIVATION, AFTER THE TARGET CAME OUT — A PROBE. Measures
// and prints; asserts nothing and always exits 0.
//
//   npx tsx scripts/diagnostics/new-business-appetite-derive.ts
//   GAMES=8 YEARS=14 npx tsx scripts/diagnostics/new-business-appetite-derive.ts
//
// ⚠ THE RATE IS BEING RE-DERIVED AGAINST A DIFFERENT JOB. The 6% that shipped
// was derived against one condition — make the appetite tiers grade, by leaving
// a strict bar short of a fixed quota. That was the right question while the
// book was held level by MEMBERSHIP_EQUILIBRIUM_ENROLLMENT and a flat intake
// cap. Both are deleted. With the outlet open the rate no longer fills a quota;
// it SETS THE BOOK'S TRAJECTORY, and a number calibrated for tier grading has
// no reason to be right for that.
//
// THE QUESTIONS NOW:
//   1. Can a pool that accepts everyone grow meaningfully over ten years?
//   2. Can a picky one shrink to the point where it is a problem?
//   3. Is either the accident of a constant, or the consequence of a decision?
//   4. Does the capacity guard bind, and if so throughout or only early?
//   5. ⚠ Does a growing book look more profitable than it is?
//
// Question 3 is answered by WHERE the trajectory settles, not whether it
// settles — see membership-flows-report for the crossing arithmetic. A plateau
// at the crossing is two flows meeting. A plateau near 63 is the deleted target
// still acting.
//
// Question 5 is the one to watch hardest. Forward booking understates incurred
// while a book is YOUNG, because the development of older years has not yet
// arrived to offset the under-booking of the newest. A permanently growing book
// is permanently young — each cohort larger than the runoff behind it — so the
// understatement never clears. Section 6 measures it as a RATIO rather than
// through the surplus, because surplus is where it shows and the ratio is where
// it is.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { memberExperienceMods, EXPERIENCE_MOD } from '../../src/utils/memberExperienceMod';
import { NEW_BUSINESS_TIERS } from '../../src/utils/newBusinessAppetite';
import { canReenroll } from '../../src/utils/membershipHistory';
import { APPLICATION_RATE, MAX_NEW_MEMBER_SHARE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, Member } from '../../src/types/simulation';

const RULE = '='.repeat(100);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RATED: CoverageLine[] = ['WC', 'GL'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 14);
const WARM = EXPERIENCE_MOD.minYears + 2;
const ARMS: (number | null)[] = [null, ...NEW_BUSINESS_TIERS];
const SWEEP = [0.03, 0.04, 0.06, 0.08, 0.12, 0.16, 0.20];

interface YearRow {
  line: string; game: number; year: number;
  bookBefore: number; book: number;
  joined: number; withdrew: number; exposure: number;
  pool: number; applicants: number; eligible: number; room: number;
  /** Intake was cut by the capacity guard rather than by supply. */
  guardBit: boolean;
  /** Under-booking on this year's cohort, and the offset arriving from prior
   *  years. Their sum over ultimate is the young-book distortion. */
  markdown: number;
  priorDev: number;
  grossUltimate: number;
  surplus: number;
}

// Memoized: sections 2-5 ask different questions of the SAME played games, and
// replaying them per section quadrupled the runtime for identical results.
const playCache = new Map<string, { rows: YearRow[]; ratios: { line: string; r: number }[] }>();
function play(appetite: number | null, rate: number): { rows: YearRow[]; ratios: { line: string; r: number }[] } {
  const key = `${appetite ?? 'all'}|${rate}`;
  const hit = playCache.get(key);
  if (hit) return hit;
  const out = playUncached(appetite, rate);
  playCache.set(key, out);
  return out;
}

function playUncached(appetite: number | null, rate: number): { rows: YearRow[]; ratios: { line: string; r: number }[] } {
  const rows: YearRow[] = [];
  const ratios: { line: string; r: number }[] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `NBA${g}`;
    const instance = generateGameInstance(id, 83_000_000 + g * 4931);
    const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y) as DecisionSet;
      for (const l of LINES) d.byLine[l].newBusinessAppetite = appetite;
      const before: Record<string, number> = {};
      for (const l of LINES) before[l] = gs.poolState.lines[l].members.length;
      const p = processYear(gs, d, { applicationRate: rate });
      const hist = p.updatedPoolState.memberLossHistory ?? {};
      const mh = p.updatedPoolState.membershipHistory;
      for (const lr of p.lineResults) {
        const l = lr.line as string;
        const x = lr.result as never as Record<string, number>;
        const enrolled = p.updatedPoolState.lines[l as CoverageLine].members;
        const ids = new Set(enrolled.map(m => m.id));
        const avail: Member[] = p.updatedPoolState.allMarketMembers.filter(
          m => !ids.has(m.id) && canReenroll(mh, m.id, l as CoverageLine, y + 1));
        const eligible = x.eligibleApplicants ?? 0;
        const room = x.intakeRoom ?? 0;
        rows.push({
          line: l, game: g, year: y,
          bookBefore: before[l], book: enrolled.length,
          joined: x.newMembers, withdrew: x.withdrawnMembers, exposure: x.activeExposure,
          pool: avail.length, applicants: x.applicants ?? 0, eligible, room,
          guardBit: room < eligible,
          markdown: (x.grossUltimateLoss ?? 0) - (x.bookedGrossUltimate ?? x.grossUltimateLoss ?? 0),
          priorDev: x.priorYearDevelopment ?? 0,
          grossUltimate: x.grossUltimateLoss ?? 0,
          surplus: x.endingSurplus ?? 0,
        });
        if (y >= WARM && appetite === null && rate === APPLICATION_RATE) {
          const mods = memberExperienceMods(avail, l as CoverageLine, hist, y + 1);
          for (const m of mods) if (m.rated && m.rawRatio !== null) ratios.push({ line: l, r: m.rawRatio });
        }
      }
      gs = {
        ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState,
        lockedResults: [...gs.lockedResults, p.result],
      };
    }
  }
  return { rows, ratios };
}

const mean = (v: readonly number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const q = (v: readonly number[], pr: number) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const i = (s.length - 1) * pr, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const pct = (n: number, d: number) => (d > 0 ? `${((100 * n) / d).toFixed(0)}%` : '—');
const label = (a: number | null) => (a === null ? 'Accept All' : `below ${a.toFixed(2)}`);

console.log(RULE);
console.log(`APPLICATION RATE, RE-DERIVED — ${GAMES} games x ${YEARS} years, no target, no intake count cap`);
console.log(RULE);
console.log(`shipped rate ${(100 * APPLICATION_RATE).toFixed(0)}%, capacity guard `
  + `${(100 * MAX_NEW_MEMBER_SHARE).toFixed(0)}% of book (JUDGEMENT, not measured)\n`);

const base = play(null, APPLICATION_RATE);

// --------------------------------------------- 1. the applicant distribution
console.log('--- 1. THE APPLICANT DISTRIBUTION THE TIERS SIT ON ---\n');
for (const l of RATED) {
  const r = base.ratios.filter(x => x.line === l).map(x => x.r);
  if (!r.length) { console.log(`${l}: none rated\n`); continue; }
  console.log(`${l} — ${r.length} rated applicant-years`);
  console.log('    p10     p25     p50     p75     p90     p95     max    mean');
  console.log([0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 1].map(p => q(r, p).toFixed(3).padStart(7)).join(' ')
    + mean(r).toFixed(3).padStart(8));
  for (const t of NEW_BUSINESS_TIERS) {
    console.log(`      below ${t.toFixed(2)} accepts ${(100 * r.filter(x => x < t).length / r.length).toFixed(1)}%`);
  }
  console.log('');
}

// --------------------------------------------------------- 2. the rate sweep
console.log('--- 2. THE RATE SWEEP — trajectory, not quota ---\n');
console.log('  rate    tier         yr1 book   yr5   yr10   final   joins/yr   departs/yr   guard bit');
for (const rate of SWEEP) {
  for (const a of ARMS) {
    const rows = play(a, rate).rows.filter(x => RATED.includes(x.line as CoverageLine));
    const at = (y: number) => mean(rows.filter(x => x.year === Math.min(y, YEARS)).map(x => x.book));
    const finals: number[] = [];
    for (const l of RATED) {
      for (let g = 0; g < GAMES; g++) {
        const gr = rows.filter(x => x.line === l && x.game === g);
        if (gr.length) finals.push(gr[gr.length - 1].book);
      }
    }
    console.log(
      `  ${(100 * rate).toFixed(0).padStart(4)}%  ${label(a).padEnd(12)}`
      + `${at(1).toFixed(1).padStart(10)}${at(5).toFixed(1).padStart(7)}${at(10).toFixed(1).padStart(7)}`
      + `${mean(finals).toFixed(1).padStart(8)}`
      + `${mean(rows.map(x => x.joined)).toFixed(2).padStart(11)}`
      + `${mean(rows.map(x => x.withdrew)).toFixed(2).padStart(13)}`
      + `${pct(rows.filter(x => x.guardBit).length, rows.length).padStart(12)}`,
    );
  }
  console.log('');
}

// ------------------------------------------- 3. the trajectory, year by year
console.log(`--- 3. THE FULL TRAJECTORY AT THE SHIPPED RATE (${(100 * APPLICATION_RATE).toFixed(0)}%) ---`);
console.log('    Growth throughout is a different mechanism from growth-then-plateau.\n');
for (const a of ARMS) {
  const rows = play(a, APPLICATION_RATE).rows;
  for (const l of RATED) {
    const cells: string[] = [];
    for (let y = 1; y <= YEARS; y++) {
      cells.push(mean(rows.filter(x => x.line === l && x.year === y).map(x => x.book)).toFixed(0).padStart(4));
    }
    console.log(`  ${label(a).padEnd(12)}${l.padEnd(5)}${cells.join('')}`);
  }
}
console.log(`  ${''.padEnd(17)}${Array.from({ length: YEARS }, (_, i) => String(i + 1).padStart(4)).join('')}  <- year\n`);

// ------------------------------------------------------- 4. the guard
console.log('--- 4. DOES THE CAPACITY GUARD BIND? ---\n');
console.log(`  It binds when applications exceed ${(100 * MAX_NEW_MEMBER_SHARE).toFixed(0)}% of the book.`);
console.log('  Binding early shapes the growth path; binding throughout means it is steering.\n');
console.log('  tier         line   guard bit   guard bit yrs 1-5   yrs 10+   mean room   mean eligible');
for (const a of ARMS) {
  const rows = play(a, APPLICATION_RATE).rows;
  for (const l of RATED) {
    const rr = rows.filter(x => x.line === l);
    const early = rr.filter(x => x.year <= 5), late = rr.filter(x => x.year >= 10);
    console.log(
      `  ${label(a).padEnd(12)}${l.padEnd(7)}${pct(rr.filter(x => x.guardBit).length, rr.length).padStart(11)}`
      + `${pct(early.filter(x => x.guardBit).length, early.length).padStart(19)}`
      + `${pct(late.filter(x => x.guardBit).length, late.length).padStart(10)}`
      + `${mean(rr.map(x => x.room)).toFixed(1).padStart(12)}`
      + `${mean(rr.map(x => x.eligible)).toFixed(1).padStart(15)}`,
    );
  }
}
console.log('');

// ------------------------------- 5. THE YOUNG-BOOK EFFECT — the one to watch
console.log('--- 5. DOES A GROWING BOOK LOOK MORE PROFITABLE THAN IT IS? ---\n');
console.log('  Forward booking marks the new cohort DOWN — measured here at ~53% of gross ultimate on');
console.log('  WC, which is what booking at a contracted estimate that develops up by 2.33x means.');
console.log('  Development on PRIOR years brings it back, arriving as adverse development.');
console.log('  In a mature book the two offset. In a growing book the markdown sits on a larger cohort');
console.log('  than the runoff behind it, so the offset never catches up.\n');
console.log('  distortion = (markdown + priorYearDevelopment) / grossUltimate, % of ultimate.');
console.log('  Positive = incurred understated = income overstated.\n');
console.log('  ⚠ COMPARED ACROSS TIERS, NOT ACROSS GROWTH-RATE BANDS WITHIN ONE ARM. Banding by');
console.log('  year-on-year growth inside a single trajectory does not span enough book-age variation');
console.log('  to separate the effect from noise — measured, and it did not. The tiers DO span it:');
console.log('  one arm ends near 63 members and shrinking, another near 97 and growing.\n');
console.log('  tier         line   yrs 1-4   yrs 5-9   yrs 10+   trend   book yr1 -> final   ending surplus $M');
for (const a of ARMS) {
  const rows = play(a, APPLICATION_RATE).rows;
  for (const l of RATED) {
    const rr = rows.filter(x => x.line === l && x.grossUltimate > 0);
    const band = (lo: number, hi: number) => 100 * mean(
      rr.filter(x => x.year >= lo && x.year <= hi).map(x => (x.markdown + x.priorDev) / x.grossUltimate));
    const early = band(1, 4), mid = band(5, 9), late = band(10, YEARS);
    const first = mean(rr.filter(x => x.year === 1).map(x => x.book));
    const last = mean(rr.filter(x => x.year === YEARS).map(x => x.book));
    console.log(
      `  ${label(a).padEnd(12)}${l.padEnd(7)}${early.toFixed(1).padStart(9)}${mid.toFixed(1).padStart(10)}`
      + `${late.toFixed(1).padStart(10)}${(late - early >= 0 ? '+' : '') + (late - early).toFixed(1)}`.padStart(8)
      + `${`${first.toFixed(0)} -> ${last.toFixed(0)}`.padStart(20)}`
      + `${(mean(rr.filter(x => x.year === YEARS).map(x => x.surplus)) / 1e6).toFixed(1).padStart(20)}`,
    );
  }
}
console.log('');
console.log('  READ IT AS: if growth causes the understatement to persist, the GROWING arms should');
console.log('  hold a higher distortion late than the SHRINKING arm, and their trend should not fall.');
console.log('');
console.log(RULE);
console.log('PROBE — no assertions. Exit 0.');
console.log(RULE);
