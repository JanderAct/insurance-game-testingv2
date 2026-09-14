// ============================================================================
// NEW BUSINESS APPETITE DERIVATION — A PROBE. It measures and prints; it
// asserts nothing and always exits 0.
//
//   npx tsx scripts/diagnostics/new-business-appetite-derive.ts
//   GAMES=10 YEARS=14 npx tsx scripts/diagnostics/new-business-appetite-derive.ts
//
// It answers four questions the tier and cap constants were set against, and
// two of the answers contradict what the control looks like it does.
//
//   1. What do the applicant ratios look like, and what share does each tier
//      accept?
//   2. What is the voluntary withdrawal rate? It decides whether any intake
//      cap is growth or standing still.
//   3. What does each tier do over a full game — book, exposure, and how often
//      the CAP binds versus how often the TIER does?
//   4. Does growth exhaust the applicant pool inside ten years? The marketplace
//      is a fixed 200 and the pool holds ~55, so a pool that keeps growing
//      eventually writes whoever is left. That is adverse selection arriving
//      through growth, and it is worth knowing whether it is reachable.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { memberExperienceMods, EXPERIENCE_MOD } from '../../src/utils/memberExperienceMod';
import { NEW_BUSINESS_TIERS } from '../../src/utils/newBusinessAppetite';
import { canReenroll } from '../../src/utils/membershipHistory';
import {
  APPLICATION_RATE, MAX_NEW_MEMBERS_PER_YEAR, MAX_NEW_MEMBER_SHARE,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, Member } from '../../src/types/simulation';

const RULE = '='.repeat(96);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RATED: CoverageLine[] = ['WC', 'GL'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 14);
const WARM = EXPERIENCE_MOD.minYears + 2;
/** null = Accept All. */
const ARMS: (number | null)[] = [null, ...NEW_BUSINESS_TIERS];

interface YearRow {
  line: string; game: number; year: number;
  book: number; joined: number; withdrew: number; exposure: number;
  /** The unenrolled, cooled-off pool the applications are drawn FROM. */
  pool: number;
  /** How many of that pool applied this year. */
  applicants: number;
  /** How many applicants cleared the bar. */
  eligible: number;
  /** How many the pool had space for, after demand and both caps. */
  room: number;
  flatBit: boolean;
  shareBit: boolean;
}

/**
 * Play every game at one appetite and one application rate.
 *
 * The three intake counts are READ OFF THE RESULT rather than recomputed here —
 * the engine records them for exactly this reason. A probe that re-derived
 * `room` from its own copy of the cap arithmetic would be measuring its own
 * copy, which is the drift this project keeps finding.
 */
function play(appetite: number | null, rate: number): { rows: YearRow[]; ratios: { line: string; r: number }[] } {
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
      const bookBefore: Record<string, number> = {};
      for (const l of LINES) bookBefore[l] = gs.poolState.lines[l].members.length;
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
        const shareCap = Math.floor(bookBefore[l] * MAX_NEW_MEMBER_SHARE);
        const room = x.intakeRoom ?? 0;
        rows.push({
          line: l, game: g, year: y,
          book: enrolled.length, joined: x.newMembers, withdrew: x.withdrawnMembers,
          exposure: x.activeExposure,
          pool: avail.length,
          applicants: x.applicants ?? 0,
          eligible: x.eligibleApplicants ?? 0,
          room,
          // room = min(rawDemand, flat, share). Which of the three it equals
          // says which one cut it; rawDemand itself is not recorded, so
          // "flat bit" is room landing exactly on the flat cap while the share
          // cap was not tighter, and vice versa.
              flatBit: room === MAX_NEW_MEMBERS_PER_YEAR && shareCap >= MAX_NEW_MEMBERS_PER_YEAR,
          shareBit: room === shareCap && shareCap < MAX_NEW_MEMBERS_PER_YEAR,
        });
        if (y >= WARM && appetite === null && rate === APPLICATION_RATE) {
          const mods = memberExperienceMods(avail, l as CoverageLine, hist, y + 1);
          for (const m of mods) if (m.rated && m.rawRatio !== null) ratios.push({ line: l, r: m.rawRatio });
        }
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
  return { rows, ratios };
}

const mean = (v: readonly number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const q = (v: readonly number[], p: number) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const pct = (n: number, d: number) => (d > 0 ? `${((100 * n) / d).toFixed(0)}%` : '—');

console.log(RULE);
console.log(`NEW BUSINESS APPETITE — ${GAMES} games x ${YEARS} years, all other decisions at default`);
console.log(RULE);
console.log(`tiers ${NEW_BUSINESS_TIERS.join(' / ')} on the applicant's RAW ratio; `
  + `caps: flat ${MAX_NEW_MEMBERS_PER_YEAR}, share ${(100 * MAX_NEW_MEMBER_SHARE).toFixed(0)}% of book\n`);

const base = play(null, APPLICATION_RATE);

// --------------------------------------------------- 1. the ratio distribution
console.log('--- 1. THE APPLICANT DISTRIBUTION THE TIERS SIT ON ---\n');
for (const l of RATED) {
  const r = base.ratios.filter(x => x.line === l).map(x => x.r);
  if (!r.length) { console.log(`${l}: none rated\n`); continue; }
  console.log(`${l} — ${r.length} rated applicant-years`);
  console.log('    p10     p25     p50     p75     p90     p95     max    mean');
  console.log([0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 1].map(p => q(r, p).toFixed(3).padStart(7)).join(' ')
    + mean(r).toFixed(3).padStart(8));
  console.log('    share of rated applicants each tier ACCEPTS:');
  for (const t of NEW_BUSINESS_TIERS) {
    console.log(`      below ${t.toFixed(2)}: ${(100 * r.filter(x => x < t).length / r.length).toFixed(1)}%`);
  }
  console.log('');
}
const propRated = base.rows.filter(x => x.line === 'Property');
console.log(`Property — ${propRated.length} line-years, 0 rated applicants `
  + `(credibility 0.000, so every tier accepts everyone and the control is inert there).\n`);

// ------------------------------------------------- 2. the withdrawal rate
console.log('--- 2. THE WITHDRAWAL RATE — does any cap make growth reachable? ---\n');
console.log('  line      mean book   joins/yr   withdrew/yr   net/yr   withdrawal rate');
for (const l of LINES) {
  const r = base.rows.filter(x => x.line === l);
  const j = mean(r.map(x => x.joined)), w = mean(r.map(x => x.withdrew));
  console.log(`  ${l.padEnd(9)}${mean(r.map(x => x.book)).toFixed(1).padStart(10)}`
    + `${j.toFixed(2).padStart(11)}${w.toFixed(2).padStart(14)}${(j - w).toFixed(2).padStart(9)}`
    + `${(100 * mean(r.map(x => x.withdrew / Math.max(1, x.book)))).toFixed(2).padStart(16)}%`);
}
console.log('');

// ---------------------------------------- 3. THE RATE SWEEP — the derivation
//
// THE CONDITION, stated before it is measured: the strict bar must SOMETIMES
// leave the pool short of its own quota. Short ⟺ eligibleApplicants <
// intakeRoom — the pool had space and the bar left nobody to fill it.
//
// At the old model's implicit 100% the strict bar left 35-49 eligible against
// an intake of 4 and was never short, which is why the tier could only ever
// change WHICH members joined. A rate is right when Accept All is essentially
// never short and the 0.75 bar is short in a bad year but not most years.
console.log('--- 3. THE RATE SWEEP — where do short years begin? ---\n');
console.log(`  short = a line-year where the bar left fewer eligible applicants than the pool had`);
console.log('  room for. Room is min(demand draw, flat cap, share cap).\n');
console.log('  rate    tier         applicants/yr   eligible/yr   room/yr   SHORT   joins/yr   mean book');
const SWEEP = [0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.15];
for (const rate of SWEEP) {
  for (const a of ARMS) {
    const rows = play(a, rate).rows.filter(x => RATED.includes(x.line as CoverageLine));
    const short = rows.filter(x => x.eligible < x.room).length;
    console.log(
      `  ${(100 * rate).toFixed(0).padStart(4)}%`
      + `  ${(a === null ? 'Accept All' : `below ${a.toFixed(2)}`).padEnd(12)}`
      + `${mean(rows.map(x => x.applicants)).toFixed(1).padStart(14)}`
      + `${mean(rows.map(x => x.eligible)).toFixed(2).padStart(14)}`
      + `${mean(rows.map(x => x.room)).toFixed(2).padStart(10)}`
      + `${pct(short, rows.length).padStart(8)}`
      + `${mean(rows.map(x => x.joined)).toFixed(2).padStart(11)}`
      + `${mean(rows.map(x => x.book)).toFixed(1).padStart(12)}`,
    );
  }
  console.log('');
}

// ------------------------------------ 4. the shipped rate, per line and arm
console.log(`--- 4. AT THE SHIPPED RATE (${(100 * APPLICATION_RATE).toFixed(0)}%) — per line ---\n`);
console.log('  tier         line   applicants   eligible   room   SHORT   room filled   joins/yr   mean book   final book');
for (const a of ARMS) {
  const rows = play(a, APPLICATION_RATE).rows;
  for (const l of RATED) {
    const rr = rows.filter(x => x.line === l);
    const finals: number[] = [];
    for (let g = 0; g < GAMES; g++) {
      const gr = rr.filter(x => x.game === g);
      if (gr.length) finals.push(gr[gr.length - 1].book);
    }
    console.log(
      `  ${(a === null ? 'Accept All' : `below ${a.toFixed(2)}`).padEnd(12)}${l.padEnd(7)}`
      + `${mean(rr.map(x => x.applicants)).toFixed(1).padStart(11)}`
      + `${mean(rr.map(x => x.eligible)).toFixed(2).padStart(11)}`
      + `${mean(rr.map(x => x.room)).toFixed(2).padStart(7)}`
      + `${pct(rr.filter(x => x.eligible < x.room).length, rr.length).padStart(8)}`
      + `${pct(rr.filter(x => x.joined >= x.room && x.room > 0).length, rr.length).padStart(13)}`
      + `${mean(rr.map(x => x.joined)).toFixed(2).padStart(11)}`
      + `${mean(rr.map(x => x.book)).toFixed(1).padStart(12)}`
      + `${mean(finals).toFixed(1).padStart(13)}`,
    );
  }
}
console.log('');

// --------------------------------- 5. what the caps still do
console.log('--- 5. DO THE CAPS STILL DO ANYTHING? ---\n');
console.log(`  flat cap ${MAX_NEW_MEMBERS_PER_YEAR}, share cap ${(100 * MAX_NEW_MEMBER_SHARE).toFixed(0)}% of book.`);
console.log('  "flat bit" = room landed exactly on the flat cap with the share cap slack, so the flat');
console.log('  cap is what set it. "share bit" = the same for the share cap. Room can also land on the');
console.log('  flat cap from the demand draw alone, so flat bit is an UPPER BOUND on how often the cap');
console.log('  truly bound rather than a count of it.\n');
console.log('  tier         line   flat bit   share bit   room/yr   eligible/yr');
for (const a of ARMS) {
  const rows = play(a, APPLICATION_RATE).rows;
  for (const l of RATED) {
    const rr = rows.filter(x => x.line === l);
    console.log(
      `  ${(a === null ? 'Accept All' : `below ${a.toFixed(2)}`).padEnd(12)}${l.padEnd(7)}`
      + `${pct(rr.filter(x => x.flatBit).length, rr.length).padStart(11)}`
      + `${pct(rr.filter(x => x.shareBit).length, rr.length).padStart(12)}`
      + `${mean(rr.map(x => x.room)).toFixed(2).padStart(10)}`
      + `${mean(rr.map(x => x.eligible)).toFixed(2).padStart(14)}`,
    );
  }
}
console.log('');

// --------------------------------- 6. growth
console.log('--- 6. IS GROWTH REACHABLE? ---\n');
console.log('  line   tier         joins/yr   withdrew/yr   net/yr   book yr1   book final   applicant pool yr1 -> final');
for (const a of ARMS) {
  const rows = play(a, APPLICATION_RATE).rows;
  for (const l of RATED) {
    const rr = rows.filter(x => x.line === l);
    const at = (pick: (x: YearRow) => number, first: boolean) => {
      const v: number[] = [];
      for (let g = 0; g < GAMES; g++) {
        const gr = rr.filter(x => x.game === g);
        if (gr.length) v.push(pick(first ? gr[0] : gr[gr.length - 1]));
      }
      return mean(v);
    };
    const j = mean(rr.map(x => x.joined)), w = mean(rr.map(x => x.withdrew));
    console.log(
      `  ${l.padEnd(7)}${(a === null ? 'Accept All' : `below ${a.toFixed(2)}`).padEnd(12)}`
      + `${j.toFixed(2).padStart(11)}${w.toFixed(2).padStart(14)}${(j - w).toFixed(2).padStart(9)}`
      + `${at(x => x.book, true).toFixed(1).padStart(11)}${at(x => x.book, false).toFixed(1).padStart(13)}`
      + `${`${at(x => x.pool, true).toFixed(0)} -> ${at(x => x.pool, false).toFixed(0)}`.padStart(29)}`,
    );
  }
}
console.log('');
console.log(RULE);
console.log('PROBE — no assertions. Exit 0.');
console.log(RULE);
