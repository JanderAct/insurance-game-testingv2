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
import { appetiteEligible, NEW_BUSINESS_TIERS } from '../../src/utils/newBusinessAppetite';
import { canReenroll } from '../../src/utils/membershipHistory';
import { MAX_NEW_MEMBERS_PER_YEAR, MAX_NEW_MEMBER_SHARE } from '../../src/data/defaultAssumptions';
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
  /** Applicants available before the tier. */
  pool: number;
  /** Applicants the tier leaves. */
  eligible: number;
  /** The intake cap in force this year. */
  cap: number;
  /** The tier removed at least one applicant the draw could otherwise reach. */
  tierBit: boolean;
  /** Intake landed on the cap. */
  capBit: boolean;
  /** The eligible pool was smaller than the cap — the tier, not the cap, is
   *  what the draw actually ran out of. */
  poolStarved: boolean;
}

function play(appetite: number | null): { rows: YearRow[]; ratios: { line: string; r: number }[] } {
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
      const p = processYear(gs, d);
      const hist = p.updatedPoolState.memberLossHistory ?? {};
      const mh = p.updatedPoolState.membershipHistory;
      for (const lr of p.lineResults) {
        const l = lr.line as string;
        const x = lr.result as never as Record<string, unknown>;
        const enrolled = p.updatedPoolState.lines[l as CoverageLine].members;
        const ids = new Set(enrolled.map(m => m.id));
        const avail: Member[] = p.updatedPoolState.allMarketMembers.filter(
          m => !ids.has(m.id) && canReenroll(mh, m.id, l as CoverageLine, y + 1));
        const elig = appetiteEligible(avail, l as CoverageLine, hist, y + 1, appetite);
        const cap = Math.min(MAX_NEW_MEMBERS_PER_YEAR,
          Math.floor(bookBefore[l] * MAX_NEW_MEMBER_SHARE));
        const joined = x.newMembers as number;
        rows.push({
          line: l, game: g, year: y,
          book: enrolled.length, joined, withdrew: x.withdrawnMembers as number,
          exposure: x.activeExposure as number,
          pool: avail.length, eligible: elig.length, cap,
          tierBit: elig.length < avail.length,
          capBit: joined >= cap && cap > 0,
          poolStarved: elig.length < cap,
        });
        if (y >= WARM && appetite === null) {
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

const base = play(null);

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

// --------------------------------- 3. each arm: book, exposure, what binds
console.log('--- 3. EACH TIER OVER A FULL GAME — and WHAT ACTUALLY BINDS ---\n');
console.log('  tier        line   mean book   final book   exposure $M   joins/yr   cap bit   tier bit   pool < cap');
for (const a of ARMS) {
  const r = a === null ? base.rows : play(a).rows;
  for (const l of RATED) {
    const rr = r.filter(x => x.line === l);
    const finals: number[] = [];
    for (let g = 0; g < GAMES; g++) {
      const gr = rr.filter(x => x.game === g);
      if (gr.length) finals.push(gr[gr.length - 1].book);
    }
    console.log(
      `  ${(a === null ? 'Accept All' : `below ${a.toFixed(2)}`).padEnd(12)}${l.padEnd(7)}`
      + `${mean(rr.map(x => x.book)).toFixed(1).padStart(10)}`
      + `${mean(finals).toFixed(1).padStart(13)}`
      + `${mean(rr.map(x => x.exposure)).toFixed(0).padStart(14)}`
      + `${mean(rr.map(x => x.joined)).toFixed(2).padStart(11)}`
      + `${pct(rr.filter(x => x.capBit).length, rr.length).padStart(10)}`
      + `${pct(rr.filter(x => x.tierBit).length, rr.length).padStart(11)}`
      + `${pct(rr.filter(x => x.poolStarved).length, rr.length).padStart(13)}`,
    );
  }
}
console.log('');
console.log('  cap bit    = intake landed on the cap in force that year');
console.log('  tier bit   = the tier removed at least one applicant the draw could otherwise reach');
console.log('  pool < cap = fewer eligible applicants than the cap allows, so the TIER is what the');
console.log('               draw ran out of rather than the cap. Where this is 0% the cap is the');
console.log('               only thing limiting intake and the tier is choosing WHICH, not HOW MANY.\n');

// ----------------------------------------------- 4. the ceiling
console.log('--- 4. THE CEILING — does growth exhaust the applicant pool in ten years? ---\n');
console.log('  The marketplace is a fixed 200. Pool + applicants + cooled-off members = 200.\n');
console.log('  tier        line   pool yr1   pool yr10   eligible yr1   eligible yr10   min eligible seen');
for (const a of ARMS) {
  const r = a === null ? base.rows : play(a).rows;
  for (const l of RATED) {
    const rr = r.filter(x => x.line === l);
    const at = (y: number, f: (x: YearRow) => number) => mean(rr.filter(x => x.year === y).map(f));
    console.log(
      `  ${(a === null ? 'Accept All' : `below ${a.toFixed(2)}`).padEnd(12)}${l.padEnd(7)}`
      + `${at(1, x => x.pool).toFixed(0).padStart(9)}`
      + `${at(Math.min(10, YEARS), x => x.pool).toFixed(0).padStart(12)}`
      + `${at(1, x => x.eligible).toFixed(0).padStart(15)}`
      + `${at(Math.min(10, YEARS), x => x.eligible).toFixed(0).padStart(16)}`
      + `${Math.min(...rr.map(x => x.eligible)).toFixed(0).padStart(20)}`,
    );
  }
}
console.log('');
console.log(RULE);
console.log('PROBE — no assertions. Exit 0.');
console.log(RULE);
