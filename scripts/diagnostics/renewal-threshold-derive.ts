// ============================================================================
// RENEWAL THRESHOLD DERIVATION — A PROBE. It measures and prints; it asserts
// nothing and always exits 0.
//
//   npx tsx scripts/diagnostics/renewal-threshold-derive.ts
//   GAMES=8 YEARS=16 npx tsx scripts/diagnostics/renewal-threshold-derive.ts
//
// ============================================================================
// WHY THIS EXISTS: THE OLD LEVELS WERE MOD NUMBERS ON A RATIO SCREEN.
//
// RENEWAL_THRESHOLDS used to be 1.25 / 1.15 / 1.10 on the DISPLAYED MODIFIER.
// Those are the right shape for a modifier — it is centred on 1.00 and Z-damped
// into a narrow band — and they are meaningless on the experience RATIO, which
// is what the screen now shows and thresholds on. The ratio's median is nowhere
// near 1.0, so a "1.10" on the ratio scale is not "10% worse than typical"; it
// is well above the middle of the book.
//
// This probe measures the ratio distribution the thresholds have to sit on, and
// prints the decline count each candidate would produce per line-year. The
// shipped level is chosen from these rows, not from the modifier's arithmetic.
//
// ============================================================================
// ⚠ THE CEILING IS WHY THE THRESHOLD IS ON THE CLAMPED RATIO AND THE COLUMN IS
// THE RAW ONE, AND IT MAKES SOME CANDIDATES UNREACHABLE.
//
// clamp is [0.5, 3.0] (Mahler rule 3). Threshold on the clamped value and every
// member at or above 3.0 raw is the same member to the tier: a member displaying
// 11.0 and one displaying 3.2 both clamp to 3.00 and are declined or renewed
// together. That is deliberate — a threshold is where stability matters — but it
// means A THRESHOLD AT OR ABOVE 3.00 DECLINES NOBODY, because the comparison is
// strictly-greater and nothing clamped can exceed the ceiling. The table below
// prints candidates up to 3.00 so that dead zone is visible rather than
// discovered.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import {
  memberExperienceMods, medianRatedMod, displayedMod, EXPERIENCE_MOD, CREDIBILITY_Z,
} from '../../src/utils/memberExperienceMod';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(94);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 6);
const YEARS = Number(process.env.YEARS ?? 14);
/** Before this the ledger has not filled and almost nobody is rated. */
const WARMUP = EXPERIENCE_MOD.minYears + 2;
/** Candidates on the clamped-ratio scale. 3.00 is included to show it is dead. */
const CANDIDATES = [1.00, 1.25, 1.50, 1.75, 2.00, 2.25, 2.50, 2.75, 3.00];

interface Obs { raw: number; clamped: number; disp: number | null; }
/** One line-year of one game. */
interface Slot { line: string; game: number; year: number; enrolled: number; obs: Obs[]; }

const slots: Slot[] = [];

for (let g = 0; g < GAMES; g++) {
  const id = `RD${g}`;
  const instance = generateGameInstance(id, 47_000_000 + g * 7013);
  const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y) as DecisionSet;
    const p = processYear(gs, d);
    gs = {
      ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState,
      lockedResults: [...gs.lockedResults, p.result],
    };
    if (y < WARMUP) continue;
    const hist = p.updatedPoolState.memberLossHistory ?? {};
    for (const l of LINES) {
      const members = p.updatedPoolState.lines[l].members;
      // yearNumber + 1: the decision for next year reads the ledger through y.
      const mods = memberExperienceMods(members, l, hist, y + 1);
      const med = medianRatedMod(mods);
      const obs: Obs[] = [];
      for (const m of mods) {
        if (!m.rated || m.rawRatio === null) continue;
        obs.push({ raw: m.rawRatio, clamped: m.clampedRatio, disp: displayedMod(m, med) });
      }
      slots.push({ line: l, game: g, year: y, enrolled: members.length, obs });
    }
  }
}

const q = (v: readonly number[], p: number) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const mean = (v: readonly number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

console.log(RULE);
console.log(`RENEWAL THRESHOLD DERIVATION — ${GAMES} games x ${YEARS} years, warm years only (y >= ${WARMUP})`);
console.log(RULE);
console.log(`clamp [${EXPERIENCE_MOD.ratioFloor}, ${EXPERIENCE_MOD.ratioCeiling}]   `
  + `Z: ${LINES.map(l => `${l} ${CREDIBILITY_Z[l]}`).join('  ')}`);
console.log('');

console.log('--- 1. THE DISTRIBUTION THE THRESHOLD SITS ON ---\n');
for (const l of LINES) {
  const ls = slots.filter(s => s.line === l);
  const obs = ls.flatMap(s => s.obs);
  const ratedSlots = ls.filter(s => s.obs.length > 0).length;
  if (!obs.length) {
    console.log(`${l}: NO RATED MEMBER-YEARS in ${ls.length} line-years `
      + `(Z = ${CREDIBILITY_Z[l]}${CREDIBILITY_Z[l] === 0 ? ', unrated by construction' : ''})\n`);
    continue;
  }
  const raw = obs.map(o => o.raw);
  const cl = obs.map(o => o.clamped);
  const dm = obs.map(o => o.disp).filter((x): x is number => x !== null);
  console.log(`${l} — ${obs.length} rated member-years across ${ratedSlots} line-years`);
  console.log('    quantity            p10     p25     p50     p75     p90     p95     p99     max     mean');
  const row = (name: string, v: readonly number[]) => console.log(
    `    ${name.padEnd(18)}`
    + [0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99, 1].map(p => q(v, p).toFixed(3).padStart(7)).join(' ')
    + mean(v).toFixed(3).padStart(9),
  );
  row('raw ratio', raw);
  row('clamped ratio', cl);
  row('displayed mod', dm);
  const hiC = raw.filter(x => x >= EXPERIENCE_MOD.ratioCeiling).length;
  const loC = raw.filter(x => x <= EXPERIENCE_MOD.ratioFloor).length;
  console.log(`    clamped at the ceiling (raw >= ${EXPERIENCE_MOD.ratioCeiling}): `
    + `${hiC} of ${raw.length} (${(100 * hiC / raw.length).toFixed(1)}%)   `
    + `at the floor (raw <= ${EXPERIENCE_MOD.ratioFloor}): ${loC} (${(100 * loC / raw.length).toFixed(1)}%)`);
  console.log('');
}

console.log('--- 2. WHAT EACH CANDIDATE WOULD DECLINE, PER LINE-YEAR ---');
console.log('    Threshold compares the CLAMPED ratio, strictly greater. One row per candidate.\n');
for (const l of LINES) {
  const ls = slots.filter(s => s.line === l && s.obs.length > 0);
  if (!ls.length) { console.log(`${l}: no rated line-years — every candidate declines nobody.\n`); continue; }
  const totalObs = ls.reduce((a, s) => a + s.obs.length, 0);
  const meanBook = mean(ls.map(s => s.enrolled));
  console.log(`${l} — ${ls.length} rated line-years, mean book ${meanBook.toFixed(1)} members`);
  console.log('    threshold   mean/yr   median/yr   max/yr   % of rated   line-years with >= 1');
  for (const t of CANDIDATES) {
    const per = ls.map(s => s.obs.filter(o => o.clamped > t).length);
    const hit = per.reduce((a, b) => a + b, 0);
    const any = per.filter(n => n >= 1).length;
    console.log(
      `    ${t.toFixed(2).padStart(9)}`
      + `${mean(per).toFixed(2).padStart(10)}`
      + `${q(per, 0.5).toFixed(1).padStart(12)}`
      + `${Math.max(...per).toFixed(0).padStart(9)}`
      + `${(100 * hit / totalObs).toFixed(1).padStart(12)}%`
      + `${`${any} of ${ls.length}`.padStart(22)}`,
    );
  }
  console.log('');
}

console.log('--- 3. THE CEILING DEAD ZONE ---\n');
console.log(`    Nothing clamped can exceed ${EXPERIENCE_MOD.ratioCeiling.toFixed(2)}, and the comparison is`);
console.log(`    strictly-greater, so EVERY candidate >= ${EXPERIENCE_MOD.ratioCeiling.toFixed(2)} declines nobody`);
console.log('    on every book. Those values are unreachable, not merely strict.');
for (const l of LINES) {
  const obs = slots.filter(s => s.line === l).flatMap(s => s.obs);
  if (!obs.length) continue;
  const tied = obs.filter(o => o.clamped >= EXPERIENCE_MOD.ratioCeiling);
  if (!tied.length) { console.log(`    ${l}: no member-year reaches the ceiling.`); continue; }
  const rawOfTied = tied.map(o => o.raw);
  console.log(`    ${l}: ${tied.length} member-years sit ON the ceiling, raw ranging `
    + `${Math.min(...rawOfTied).toFixed(2)} to ${Math.max(...rawOfTied).toFixed(2)}. `);
  console.log(`         All of them are one member to any tier — that is the clamp doing its job.`);
}
console.log('');

// ---------------------------------------------------------------------------
// 4. THE BOOK EFFECT — the question the count per year does not answer.
//
// A decline carries a two-year cooldown, so the steady-state cost of holding a
// level is not its yearly count. The old mod-scale 1.10 took WC from 55.5 to
// 35.3 members; that is not a renewal decision, it is a different pool. This
// section plays the finalists with the threshold APPLIED and reports where the
// book lands.
// ---------------------------------------------------------------------------
const FINALISTS = [null, 2.00, 2.50, 2.75] as const;

function playWith(threshold: number | null): Record<string, { enrolled: number[]; declines: number[] }> {
  const out: Record<string, { enrolled: number[]; declines: number[] }> = {
    WC: { enrolled: [], declines: [] }, GL: { enrolled: [], declines: [] },
    Property: { enrolled: [], declines: [] },
  };
  for (let g = 0; g < GAMES; g++) {
    const id = `RD${g}`;
    const instance = generateGameInstance(id, 47_000_000 + g * 7013);
    const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y) as DecisionSet;
      for (const l of LINES) d.byLine[l].renewalThreshold = threshold;
      const p = processYear(gs, d);
      gs = {
        ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState,
        lockedResults: [...gs.lockedResults, p.result],
      };
      if (y < WARMUP) continue;
      for (const lr of p.lineResults) {
        const x = lr.result as never as Record<string, unknown>;
        out[lr.line as string].enrolled.push(x.activeMembers as number);
        out[lr.line as string].declines.push((x.declinedMembers as number) ?? 0);
      }
    }
  }
  return out;
}

console.log('--- 4. THE BOOK EFFECT, THRESHOLD APPLIED ---');
console.log('    Two-year cooldown means the steady-state cost is not the yearly count.\n');
const base = playWith(null);
console.log('    line   threshold   mean book   vs Renew All   mean declines/yr   final-year book');
for (const t of FINALISTS) {
  const res = t === null ? base : playWith(t);
  for (const l of ['WC', 'GL'] as const) {
    const enr = res[l].enrolled, dec = res[l].declines;
    const b = mean(base[l].enrolled);
    const m = mean(enr);
    // last warm year of each game
    const perGame = YEARS - WARMUP + 1;
    const finals: number[] = [];
    for (let g = 0; g < GAMES; g++) finals.push(enr[(g + 1) * perGame - 1]);
    console.log(
      `    ${l.padEnd(6)}${(t === null ? 'Renew All' : t.toFixed(2)).padStart(10)}`
      + `${m.toFixed(1).padStart(12)}`
      + `${(t === null ? '—' : `${(m - b >= 0 ? '+' : '')}${(m - b).toFixed(1)}`).padStart(15)}`
      + `${mean(dec).toFixed(2).padStart(19)}`
      + `${mean(finals).toFixed(1).padStart(18)}`,
    );
  }
}
console.log('');
console.log(RULE);
console.log('PROBE — no assertions. Exit 0.');
console.log(RULE);
