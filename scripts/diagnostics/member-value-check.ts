// ============================================================================
// MEMBER VALUE — WHAT THE MONEY BOUGHT, AND WHAT THE TERM IS NOT ALLOWED TO DO.
//
// Eight sections, and three of them exist to keep a RULING checkable rather than
// recorded in a comment. That distinction is this repo's recurring lesson: the
// level weight's derivation went stale behind a comment and was only caught when
// the gate was made to assert it, and the join-draw width was corrected three
// times by its own gate.
//
//   1. THE POTS ARE LAYERS AND THEY ARE EXHAUSTIVE. With a control that fails on
//      the claim-size banding this replaced.
//   2. IT FEEDS NOTHING. Static allow-list over src/, the same instrument
//      member-satisfaction-check uses and for the same reason.
//   3. POOL AGAINST MARKET at defaults, per line, with a priced-up control.
//   4. MEMBER AGAINST POOL rebases to 1 on the book, by construction.
//   5. THE TOWER IS DISCLOSED AND NOT RATED, and the row shape enforces it.
//   6. THE LOWER BOUNDARY BUYS NOTHING — the rejection, re-measured every run.
//   7. retainedAboveTower IS NOT THE SOURCE, and reads 0 while real dollars sit
//      above the tower. A trap recorded as a test.
//   8. THE POOL'S ONE-YEAR RATIO IS LUCK, which is why the reported window
//      matters. Asserted against what pure noise would give.
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import {
  memberValueRows, potBounds, potSplit, potTotals, potsAreExhaustive,
} from '../../src/utils/memberValue';
import { MARKET_TARGET_LOSS_RATIO } from '../../src/utils/marketConditions';
import { TOWER_TOP } from '../../src/data/reinsuranceTower';
import type {
  Claim, CoverageLine, DecisionSet, GameState, LineResultSet, MemberPremiumShare,
} from '../../src/types/simulation';

const RULE = '='.repeat(78);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 12);
/**
 * ⚠ THE RULING, AS A LIST. Every file in src/ that may touch the value terms.
 * Nothing DISPLAYS them yet, which is why this list is four entries and not
 * eleven — and a display surface is a legitimate addition, while a DECISION
 * reading them is not. See memberValue.ts on why: the member-level ratio's
 * measured test-retest correlation is zero, so anything acting on a member has
 * to read the experience modifier instead.
 */
const ALLOWED: Record<string, string> = {
  'src/types/simulation.ts': 'the row declarations',
  'src/utils/memberValue.ts': 'the model itself',
  'src/utils/simulationEngine.ts': 'the post-claims value pass',
  'src/utils/gameSave.ts': 'memberValueRows and poolValue on SAVE_STRIPPED_KEYS',
};
/**
 * How close the split-with-a-weight must sit to the unsplit pot before the
 * lower boundary counts as buying nothing. 0.94 is the WORST reading measured
 * across the plausible middle of the weight range, not a round number: the
 * measured set is 0.9901 / 0.9993 / 0.9456 on WC, 0.9975 / 0.9959 / 0.9613 on
 * GL, 0.9944 / 0.9982 / 0.9396 on Property at w = 0.25 / 0.50 / 0.75.
 */
const MIN_SPLIT_EQUIVALENCE = 0.90;
/** The priced-up arm, matching member-satisfaction-check's. */
const RAMP_START = 0.60;
const RAMP_STEP = 0.035;

const failures: string[] = [];
const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN);
const sd = (v: number[]) => { const m = mean(v); return Math.sqrt(mean(v.map(x => (x - m) ** 2))); };
const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
};
const money = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v).toLocaleString()}`);
/** The layer of each claim that falls in [lo, hi). */
const layer = (cs: readonly Claim[], lo: number, hi: number) =>
  cs.reduce((s, c) => s + Math.max(0, Math.min(c.grossUltimate, hi) - lo), 0);

interface Row {
  line: CoverageLine; game: number; year: number;
  claims: Claim[]; shares: MemberPremiumShare[]; placed: boolean[] | undefined;
  expected: number; result: LineResultSet;
}

function run(games: number, years: number, decisions: (y: number) => DecisionSet): Row[] {
  const rows: Row[] = [];
  for (let g = 0; g < games; g++) {
    const id = `MV${g}`;
    const instance = generateGameInstance(id, 41_000_000 + g * 7919);
    const setup = { poolName: 'V', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= years; y++) {
      const p = processYear(gs, decisions(y));
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
      for (const lr of p.lineResults) {
        const r = lr.result;
        rows.push({
          line: lr.line as CoverageLine, game: g, year: y,
          claims: r.claims ?? [], shares: r.memberPremiumShares ?? [],
          placed: r.decisions?.layersPlaced,
          expected: (r.memberLossResults ?? []).reduce((s, m) => s + m.expectedLoss, 0),
          result: r,
        });
      }
    }
  }
  return rows;
}

console.log(RULE);
console.log(`MEMBER VALUE CHECK — ${GAMES} games x ${YEARS} years`);
console.log(RULE);

const rows = run(GAMES, YEARS, y => defaultDecisionSet(y) as DecisionSet);

// --- 1. the pots are layers, and exhaustive ---------------------------------
console.log('\n--- 1. the pots are LAYERS and they are exhaustive ---');
{
  let bad = 0;
  for (const r of rows) if (!potsAreExhaustive(r.claims, r.line, r.placed)) bad++;
  console.log(`  ${rows.length} line-years, ${bad} where retained + tower + above != gross`);
  if (bad > 0) {
    failures.push(`${bad} line-years fail the pot identity. The three layers must sum to the gross `
      + `loss for every claim; if they do not, dollars are being created or lost between pots.`);
  }
  // ⚠ THE CONTROL. A claim-size BANDING — the thing this replaced — puts a $3M
  // WC claim wholly in the tower band and reports zero retained loss for it.
  // Measured against the layer basis it must DISAGREE, or the two bases are the
  // same thing and the header's correction is empty.
  for (const line of LINES) {
    const cs = rows.filter(r => r.line === line).flatMap(r => r.claims);
    const { retention } = potBounds(line);
    const layerRetained = potTotals(cs, line).retained;
    const bandRetained = cs.filter(c => c.grossUltimate < retention).reduce((s, c) => s + c.grossUltimate, 0);
    const understated = 1 - bandRetained / layerRetained;
    console.log(`  ${line.padEnd(9)} layer basis ${money(layerRetained)}   claim-size banding `
      + `${money(bandRetained)}   banding understates the member-funded pot by ${(100 * understated).toFixed(1)}%`);
    if (!(understated > 0.05)) {
      failures.push(`on ${line} the claim-size banding and the layer basis agree to within 5%. The `
        + `control is inert: either the tower never fires or potSplit is not splitting.`);
    }
  }
  // and one claim, by hand, so the arithmetic is visible rather than aggregate
  const s = potSplit(3_000_000, 'WC');
  console.log(`  a $3.00M WC claim, all layers placed: retained ${money(s.retained)}  `
    + `tower ${money(s.tower)}  above ${money(s.aboveTower)}`);
  if (s.retained !== 1e6 || s.tower !== 2e6 || s.aboveTower !== 0) {
    failures.push(`potSplit($3M, WC) returned ${JSON.stringify(s)} rather than 1M / 2M / 0.`);
  }
  // ⚠ THE PLACEMENT CONTROL. Declining the $4M xs $1M layer means nobody bought
  // cover for that band, so its loss is pool-funded and must move to `retained`.
  // At default decisions every layer is placed and this distinction is invisible,
  // which is exactly why it needs a test rather than a reading.
  const d = potSplit(3_000_000, 'WC', [false, true, true]);
  console.log(`  the same claim with $4M xs $1M DECLINED:   retained ${money(d.retained)}  `
    + `tower ${money(d.tower)}  above ${money(d.aboveTower)}`);
  if (!(d.retained === 3e6 && d.tower === 0)) {
    failures.push(`declining WC's first layer left ${JSON.stringify(d)}; the whole $3M should be `
      + `retained. A pot split that ignores the placement reports a member as funded by `
      + `reinsurance nobody bought.`);
  }
  // and a DISJOINT retained band — decline the middle layer only — which is the
  // case a hand-rolled min/max pair gets wrong.
  const j = potSplit(8_000_000, 'WC', [true, false, true]);
  console.log(`  a $8.00M WC claim with only the MIDDLE layer declined: retained ${money(j.retained)}  `
    + `tower ${money(j.tower)}  above ${money(j.aboveTower)}`);
  if (!(j.tower === 4e6 && j.retained === 4e6)) {
    failures.push(`a disjoint placement split $8M as ${JSON.stringify(j)}; $1M below the tower plus `
      + `$3M in the declined $5M xs $5M band is $4M retained, and $4M ceded through $4M xs $1M.`);
  }
}

// --- 2. it feeds nothing ----------------------------------------------------
console.log('\n--- 2. nothing reads it (static) ---');
{
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      const body = readFileSync(p, 'utf8');
      // The result keys, the model's exports, and the row types — three patterns
      // because a consumer can reach the mechanic through any of them, and
      // matching only the field name would miss a file that calls potTotals.
      if (/\b(memberValueRows|poolValue|retainedValue|towerRecovered|reachedTower)\b/.test(body)
        || /\b(potSplit|potTotals|memberPotTotals|poolValueRow|potBounds|potsAreExhaustive)\b/.test(body)
        || /\b(PotTotals|MemberValueRow|PoolValueRow)\b/.test(body)) {
        hits.push(p.replace(/\\/g, '/'));
      }
    }
  };
  walk('src');
  const unexpected = hits.filter(h => !(h in ALLOWED));
  const missing = Object.keys(ALLOWED).filter(a => !hits.includes(a));
  for (const h of hits.sort()) console.log(`  ${h.padEnd(42)} ${ALLOWED[h] ?? '*** NOT ON THE ALLOW-LIST ***'}`);
  if (unexpected.length > 0) {
    failures.push(`the value terms are touched by ${unexpected.join(', ')}, which is not on the `
      + `allow-list. A DISPLAY surface is a legitimate addition; a DECISION reading them is not — `
      + `the member-level ratio's test-retest correlation is zero, so anything acting on a member `
      + `must read the experience modifier instead.`);
  }
  if (missing.length > 0) {
    failures.push(`the allow-list names ${missing.join(', ')}, which no longer touches the terms. `
      + `A stale allow-list is one nobody trusts; remove the entry.`);
  }
}

// --- 3. pool against market -------------------------------------------------
console.log('\n--- 3. POOL AGAINST MARKET at defaults ---');
console.log('  line      returned/$  vs carrier   tower ret/$  reinsurer bmk  vs reinsurer  above tower');
const defaultsValue = new Map<CoverageLine, number>();
{
  for (const line of LINES) {
    const rs = rows.filter(r => r.line === line);
    const v = rs.map(r => r.result.poolValue!).filter(Boolean);
    if (v.length !== rs.length) {
      failures.push(`${line}: ${rs.length - v.length} line-years carry no poolValue row.`);
      continue;
    }
    const m = (f: (x: typeof v[number]) => number) => mean(v.map(f));
    defaultsValue.set(line, m(x => x.valueAgainstMarket));
    console.log(`  ${line.padEnd(9)} ${m(x => x.returnedPerDollar).toFixed(3).padStart(9)}`
      + `${m(x => x.valueAgainstMarket).toFixed(3).padStart(12)}`
      + `${m(x => x.towerReturnedPerDollar).toFixed(3).padStart(13)}`
      + `${m(x => x.reinsurerBenchmark).toFixed(3).padStart(14)}`
      + `${m(x => x.valueAgainstReinsurer).toFixed(3).padStart(14)}`
      + `${money(v.reduce((s, x) => s + x.aboveTowerDollars, 0)).padStart(13)}`);
    if (!(Math.abs(v[0].marketBenchmark - MARKET_TARGET_LOSS_RATIO) < 1e-12)) {
      failures.push(`${line}: the market benchmark is not MARKET_TARGET_LOSS_RATIO. The value term and `
        + `the satisfaction level term must not hold two different opinions of what a carrier charges.`);
    }
    // The reinsurer's benchmark is E[ceded]/premium and the tower is priced at
    // E + lambda.SD with lambda 0.60, so it MUST sit below 1 — a reinsurer that
    // expected to pay out its whole premium would be running a charity.
    if (!(m(x => x.reinsurerBenchmark) > 0 && m(x => x.reinsurerBenchmark) < 1)) {
      failures.push(`${line}: the reinsurer's implied loss ratio reads `
        + `${m(x => x.reinsurerBenchmark).toFixed(3)}, outside (0, 1). It is expectedCeded over the `
        + `quoted premium and the quote carries a positive risk load, so it cannot reach 1.`);
    }
  }
}

// ⚠ THE POSITIVE CONTROL. A pool that prices itself UP returns less per dollar
// billed for the same losses, so valueAgainstMarket must FALL. Without this the
// section is three numbers nobody can falsify.
console.log('\n  CONTROL: the same seeds, priced up the funding slider');
{
  const up = run(GAMES, YEARS, y => {
    const d = defaultDecisionSet(y) as DecisionSet;
    for (const l of LINES) {
      d.byLine[l].fundingAtExpected = false;
      d.byLine[l].fundingConfidenceLevel = Math.min(0.95, RAMP_START + RAMP_STEP * (y - 1));
    }
    return d;
  });
  for (const line of LINES) {
    const u = mean(up.filter(r => r.line === line).map(r => r.result.poolValue!.valueAgainstMarket));
    const d = defaultsValue.get(line)!;
    const ok = u < d;
    console.log(`  ${line.padEnd(9)} defaults ${d.toFixed(3)}   priced up ${u.toFixed(3)}   `
      + `${(u - d).toFixed(3)}  ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) {
      failures.push(`${line}: pricing up the funding slider did not reduce value against the market `
        + `(${d.toFixed(3)} -> ${u.toFixed(3)}). More premium for the same losses is less returned per `
        + `dollar; if this does not move, the term is not reading the premium.`);
    }
  }
}

// --- 4. member against pool rebases to 1 ------------------------------------
console.log('\n--- 4. MEMBER AGAINST POOL rebases to 1 on the book ---');
{
  for (const line of LINES) {
    const devs: number[] = [];
    let members = 0;
    for (const r of rows.filter(x => x.line === line)) {
      const vr = memberValueRows(r.shares, r.claims, r.line, r.placed);
      const totalPrem = vr.reduce((s, m) => s + m.premium, 0);
      if (!(totalPrem > 0)) continue;
      // premium-weighted mean of the ratio IS the book's own ratio over itself
      const w = vr.reduce((s, m) => s + m.premium * m.retainedValue, 0) / totalPrem;
      devs.push(w - 1);
      members += vr.length;
    }
    const worst = Math.max(...devs.map(Math.abs));
    console.log(`  ${line.padEnd(9)} ${devs.length} line-years, ${members} member-years, `
      + `worst |premium-weighted mean - 1| = ${worst.toExponential(2)}`);
    if (!(worst < 1e-9)) {
      failures.push(`${line}: the premium-weighted member value does not rebase to 1 (worst `
        + `${worst.toExponential(2)}). The book is the denominator by construction; if this drifts, `
        + `the rows are being divided by something other than the book they came from.`);
    }
  }
  // ⚠ CONTROL: rebasing to 1 is trivially true if every row IS 1. It is not.
  const spread = rows.filter(r => r.line === 'WC').flatMap(r =>
    memberValueRows(r.shares, r.claims, r.line, r.placed).map(m => m.retainedValue));
  console.log(`  CONTROL: WC member value SD across ${spread.length} member-years = ${sd(spread).toFixed(3)}`);
  if (!(sd(spread) > 0.5)) {
    failures.push(`WC member value has SD ${sd(spread).toFixed(3)}. The rebase assertion above passes `
      + `trivially if every row is 1; it must not be.`);
  }
}

// --- 5. the tower is disclosed, not rated -----------------------------------
console.log('\n--- 5. the tower is DISCLOSED, not RATED ---');
{
  for (const line of LINES) {
    const vr = rows.filter(r => r.line === line).flatMap(r => memberValueRows(r.shares, r.claims, r.line, r.placed));
    const reached = vr.filter(m => m.reachedTower).length;
    console.log(`  ${line.padEnd(9)} ${vr.length} member-years, ${reached} reached the tower `
      + `(${(100 * reached / vr.length).toFixed(2)}%), recovered ${money(vr.reduce((s, m) => s + m.towerRecovered, 0))}`);
    // The ruling as a shape assertion: the row carries DOLLARS and a FLAG, and
    // no field on it divides tower loss by anything. A future edit that adds a
    // `towerValue` ratio has to come through this gate.
    const keys = Object.keys(vr[0] ?? {});
    const rated = keys.filter(k => /tower/i.test(k) && /value|ratio|index/i.test(k));
    if (rated.length > 0) {
      failures.push(`MemberValueRow has ${rated.join(', ')}. The tower must not be a per-member RATIO: `
        + `${(100 * (1 - reached / vr.length)).toFixed(0)}% of ${line} member-years never reach the layer, `
        + `and a ratio says they were robbed. They bought a LIMIT, delivered every year.`);
    }
  }
}

// --- 6. the lower boundary buys nothing -------------------------------------
console.log('\n--- 6. THE REJECTED LOWER BOUNDARY, re-measured ---');
console.log('  Splitting the retained pot at 100k / 100k / 500k, against not splitting it.');
console.log('  line      corr(lo,hi)   w=0.25   w=0.50   w=0.75   worst');
{
  const LOWER: Record<string, number> = { WC: 100e3, GL: 100e3, Property: 500e3 };
  for (const line of LINES) {
    const rs = rows.filter(r => r.line === line);
    const { retention } = potBounds(line);
    const B = LOWER[line];
    const idx = (lo: number, hi: number) => {
      const raw = rs.map(r => layer(r.claims, lo, hi) / r.expected);
      const m = mean(raw);
      return raw.map(v => v / m);
    };
    const iLo = idx(0, B), iHi = idx(B, retention), iPot = idx(0, retention);
    const at = (w: number) => corr(iLo.map((v, i) => w * v + (1 - w) * iHi[i]), iPot);
    const ws = [0.25, 0.5, 0.75].map(at);
    const worst = Math.min(...ws);
    console.log(`  ${line.padEnd(9)} ${corr(iLo, iHi).toFixed(3).padStart(10)}`
      + ws.map(v => v.toFixed(4).padStart(9)).join('') + `${worst.toFixed(4).padStart(9)}`);
    if (!(worst >= MIN_SPLIT_EQUIVALENCE)) {
      failures.push(`on ${line} the split reads ${worst.toFixed(4)} against the unsplit pot at its worst `
        + `plausible weight, below ${MIN_SPLIT_EQUIVALENCE}. THE REJECTION OF THE LOWER BOUNDARY RESTS ON `
        + `THIS EQUIVALENCE — if the split has started to say something different, memberValue.ts's header `
        + `is now wrong and the boundary deserves re-arguing rather than this threshold being lowered.`);
    }
  }
}

// --- 7. retainedAboveTower is not the source --------------------------------
console.log('\n--- 7. retainedAboveTower IS NOT THE SOURCE, and here is why ---');
{
  for (const line of LINES) {
    const rs = rows.filter(r => r.line === line);
    const field = rs.reduce((s, r) => s + (r.result.retainedAboveTower ?? 0), 0);
    const real = rs.reduce((s, r) => s + layer(r.claims, TOWER_TOP[line as 'WC'], Infinity), 0);
    const nonZero = rs.filter(r => (r.result.retainedAboveTower ?? 0) > 0).length;
    console.log(`  ${line.padEnd(9)} engine field ${money(field).padStart(11)} (>0 in ${nonZero} of `
      + `${rs.length} line-years)   drawn claims above the top ${money(real).padStart(11)}`);
    if (line === 'GL' && !(real > 0 && field === 0)) {
      failures.push(`GL's retainedAboveTower reads ${money(field)} against ${money(real)} of drawn loss `
        + `above the tower. THIS ASSERTION RECORDS A TRAP: the field is set ONCE, at inception, from the `
        + `BOOKED occurrence, and initialEstimate contracts a $40M claim to about $7M — so it reads 0 `
        + `while the excess accrues later through cedeDevelopment into undifferentiated retained loss. `
        + `If the field has started reporting, the engine changed and memberValue.ts should read it `
        + `instead of re-deriving the layer from claims.`);
    }
  }
}

// --- 8. the pool's one-year ratio is luck -----------------------------------
console.log('\n--- 8. HOW MUCH OF A ONE-YEAR POOL RATIO IS LUCK ---');
console.log('  3yr SD / 1yr SD, against sqrt(1/3) = 0.577 for pure independent noise, and lag-1');
console.log('  autocorrelation within a game. Near 0.577 with autocorr ~0 means averaging is all a');
console.log('  window buys — there is no persistent service component for it to reveal.');
console.log('  line      pot        1yr SD   3yr SD   ratio   autocorr');
{
  for (const line of LINES) {
    const { retention, towerTop } = potBounds(line);
    for (const [name, lo, hi] of [['retained', 0, retention], ['tower', retention, towerTop]] as Array<[string, number, number]>) {
      const rs = rows.filter(r => r.line === line);
      const one = new Map<string, number>();
      for (const r of rs) one.set(`${r.game}|${r.year}`, layer(r.claims, lo, hi) / r.expected);
      const m1 = mean([...one.values()]);
      const i1 = [...one.values()].map(v => v / m1);
      const three: number[] = [];
      for (let g = 0; g < GAMES; g++) {
        for (let y = 3; y <= YEARS; y++) {
          let L = 0, E = 0, ok = true;
          for (let k = y - 2; k <= y; k++) {
            const r = rs.find(z => z.game === g && z.year === k);
            if (!r) { ok = false; break; }
            L += layer(r.claims, lo, hi); E += r.expected;
          }
          if (ok && E > 0) three.push(L / E);
        }
      }
      const m3 = mean(three);
      const i3 = three.map(v => v / m3);
      const a: number[] = [], b: number[] = [];
      for (let g = 0; g < GAMES; g++) {
        for (let y = 2; y <= YEARS; y++) {
          const p = one.get(`${g}|${y - 1}`), q = one.get(`${g}|${y}`);
          if (p !== undefined && q !== undefined) { a.push(p); b.push(q); }
        }
      }
      console.log(`  ${line.padEnd(9)} ${name.padEnd(10)} ${sd(i1).toFixed(3).padStart(6)}   `
        + `${sd(i3).toFixed(3).padStart(6)}   ${(sd(i3) / sd(i1)).toFixed(2).padStart(5)}   ${corr(a, b).toFixed(3).padStart(7)}`);
    }
  }
  console.log('  REPORTED, NOT ASSERTED — this section exists so the window question stays answered by');
  console.log('  measurement. memberValue.ts ships a ONE-YEAR row and says so; if these ratios ever fall');
  console.log('  well below 0.577 with a positive autocorrelation, a window would start buying something.');
}

console.log('\n' + RULE);
if (failures.length === 0) {
  console.log('MEMBER VALUE HOLDS.');
  console.log(RULE);
  process.exit(0);
}
console.log(`${failures.length} FAILURE(S):`);
for (const f of failures) console.log(`  - ${f}`);
console.log(RULE);
process.exit(1);
