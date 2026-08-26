// ============================================================================
// SIZING THE CLAIM-LEVEL DEVELOPMENT FIX — measurement only, nothing built.
//
// THE QUESTION: if reserve development landed on CLAIMS rather than on a net
// reserve balance, what share of it would clear the retention and cede?
//
// The 40% back-of-envelope comes from one year's realised cession rate on
// CURRENT-YEAR gross. That rate is not transferable, because cession is a
// per-occurrence excess calculation and development is a MARGINAL increment on
// top of an existing occurrence. $25M spread over three claims already above
// $1M cedes almost entirely; the same $25M spread over forty $200K claims
// cedes almost nothing. Only measurement separates those.
//
// ⚠ THE MARGINAL RATE IS THE RIGHT QUANTITY, NOT THE AVERAGE. What is reported
// throughout is
//
//     ceded share = [ cede(totals + delta) - cede(totals) ] / sum(delta)
//
// on the accident year's OWN occurrence register, under the layers placed in
// that accident year (occurrence cover attaches to the accident year, not the
// valuation year). Comparing against a fresh cede() of the development alone
// would attach every dollar at $0 and overstate the answer enormously.
//
// ⚠ AND THE DEVELOPMENT BEING ALLOCATED IS THE ONE THE ENGINE ACTUALLY PRODUCES.
// Today's development moves a NET reserve, so a gross development does not
// exist anywhere. This treats the observed net movement as the gross increment
// to allocate, which is the conservative reading: any fix that grossed it up
// first would cede MORE, not less. Stated because it is an assumption, not a
// measurement.
//
// ⚠ DEVELOPMENT IS APPLIED CUMULATIVELY, ON A LIVE REGISTER PER RULE. An earlier
// version measured every valuation's marginal cession against the ORIGINAL
// register, which understates: by year 5 the claims should already carry years
// 1-4's development, and a claim sitting at $900K after four adverse years is
// one dollar from ceding while the original register still shows it retained.
// Each rule therefore carries its own evolving register and each year's
// increment lands on top of the last.
//
// ⚠ AND THE BASELINE IS COUNTED ONCE PER ACCIDENT YEAR. The same earlier version
// added the register's ceded total once per VALUATION, so a ten-year-old accident
// year entered the denominator ten times and E[ceded] came out at $58.8bn on a
// book that cedes a small fraction of that. The uplift percentage was the figure
// that mattered and it was wrong by roughly an order of magnitude.
//
// ALLOCATION IS A FREE PARAMETER — there is no data behind "how many claims take
// the development". So every rule below is run over the same events and the
// spread between them IS the sensitivity result.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { cedeOccurrences, occurrenceTotals } from '../../src/utils/reinsuranceTower';
import { REINSURANCE_TOWER, TOWER_TOP, type TowerLine } from '../../src/data/reinsuranceTower';
import { WC_SEVERITY_CAP } from '../../src/data/defaultAssumptions';
import { wcSeverityTrend } from '../../src/utils/wcClaimEngine';
import type { CoverageLine, GameState, ReserveCohort } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 60);
const YEARS = Number(process.env.YEARS ?? 10);
const LINES: TowerLine[] = ['WC', 'GL', 'Property'];

// ---------------------------------------------------------------- allocation
interface Rule { name: string; alloc: (totals: number[], D: number) => number[] }

// Split D across the chosen indices, proportional to weight.
function spread(n: number, idx: number[], weight: (i: number) => number, D: number): number[] {
  const delta = new Array(n).fill(0);
  const w = idx.map(weight);
  const sw = w.reduce((a, b) => a + b, 0);
  if (sw <= 0) { if (idx.length) delta[idx[0]] = D; return delta; }
  idx.forEach((i, j) => { delta[i] = D * (w[j] / sw); });
  return delta;
}
const largestK = (totals: number[], k: number) =>
  totals.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, i]) => i);

const RULES: Rule[] = [
  { name: 'largest-1', alloc: (t, D) => spread(t.length, largestK(t, 1), () => 1, D) },
  { name: 'largest-3 sized', alloc: (t, D) => spread(t.length, largestK(t, 3), i => t[i], D) },
  { name: 'largest-3 flat', alloc: (t, D) => spread(t.length, largestK(t, 3), () => 1, D) },
  { name: 'largest-10 sized', alloc: (t, D) => spread(t.length, largestK(t, 10), i => t[i], D) },
  { name: 'largest-10 flat', alloc: (t, D) => spread(t.length, largestK(t, 10), () => 1, D) },
  // Every claim scales together — the register is simply restated. This is the
  // "no allocation choice at all" baseline and the one with the fewest invented
  // degrees of freedom.
  { name: 'all sized', alloc: (t, D) => spread(t.length, t.map((_, i) => i), i => t[i], D) },
  { name: 'all flat', alloc: (t, D) => spread(t.length, t.map((_, i) => i), () => 1, D) },
];

// ---------------------------------------------------------------- collection
interface Event {
  line: TowerLine; game: number; valYear: number; accidentYear: number;
  D: number;                          // gross-equivalent development, adverse positive
  shareByRule: Record<string, number>;
  registerClaims: number;
  hasRegister: boolean;
  maxOccBefore: number; maxOccAfter: number;
}
const events: Event[] = [];
let devNoRegister = 0, devWithRegister = 0;
let capBreaches = 0, capBreachWorst = 0, wcDevelopedMax = 0;
// ⚠ BASELINE COUNTED ONCE PER (game, line, ACCIDENT YEAR) — see the header.
let aboveTowerDelta = 0, grossDelta = 0;
let cededBefore = 0, grossBefore = 0;
const cededAfterByRule: Record<string, number> = {};
for (const r of RULES) cededAfterByRule[r.name] = 0;
const REF_RULE = 'largest-3 sized';
// The cap question is asked of EVERY rule, not just the reference one — the rule
// that concentrates hardest is the one most likely to push a claim past a bound
// the draw guarantees, so checking only the middle rule would miss it.
const capStat: Record<string, { max: number; breaches: number; worst: number; overTop: number }> = {};
for (const r of RULES) capStat[r.name] = { max: 0, breaches: 0, worst: 0, overTop: 0 };

for (let g = 0; g < GAMES; g++) {
  const id = `DCS${g}`;
  const inst = generateGameInstance(id, 4_100_000 + g * 7919);
  const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES as CoverageLine[] };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  // Register per (line, accident year), captured as the year is written.
  const register = new Map<string, { totals: number[]; placed: boolean[] }>();
  const live = new Map<string, Record<string, number[]>>();
  const key = (l: string, y: number) => `${l}|${y}`;

  // ⚠ THE PRE-GAME REGISTERS ARE REAL AND ARE AVAILABLE, so they are loaded
  // rather than written off. priorHistory carries each pre-game year's own
  // claims and occurrences on byLine, and accident years -2..0 are 20.8% of all
  // adverse development — leaving them out would have reported a fifth of the
  // book as unallocatable when it is nothing of the kind. Only the SEED cohorts
  // are genuinely register-less, and that is the number the fallback question
  // turns on.
  for (const pg of priorHistory) {
    for (const line of LINES) {
      const lr = pg.byLine[line];
      if (!lr?.claims || !lr.occurrences) continue;
      const totals = occurrenceTotals(lr.claims, lr.occurrences);
      const placed = [...(lr.decisions?.layersPlaced ?? REINSURANCE_TOWER[line].map(l => l.purchasable))];
      register.set(key(line, pg.yearNumber), { totals, placed });
      cededBefore += cedeOccurrences(line, totals, placed).totalCeded;
      grossBefore += totals.reduce((s2, t) => s2 + t, 0);
    }
  }

  for (let y = 1; y <= YEARS; y++) {
    const before: Record<string, ReserveCohort[]> = {};
    for (const l of LINES) before[l] = gs.poolState.lines[l].reserveCohorts.map(c => ({ ...c }));

    const processed = processYear(gs, defaultDecisionSet(y));

    for (const line of LINES) {
      const r = processed.result.byLine[line];
      // This accident year's own register, for later valuations to develop.
      if (r.claims && r.occurrences) {
        const totals = occurrenceTotals(r.claims, r.occurrences);
        const placed = [...(r.decisions?.layersPlaced ?? REINSURANCE_TOWER[line].map(l => l.purchasable))];
        register.set(key(line, y), { totals, placed });
        cededBefore += cedeOccurrences(line, totals, placed).totalCeded;
        grossBefore += totals.reduce((s2, t) => s2 + t, 0);
      }

      const after = new Map(processed.updatedPoolState.lines[line].reserveCohorts.map(c => [c.yearNumber, c]));
      for (const b of before[line]) {
        if (b.closed) continue;
        const a = after.get(b.yearNumber);
        if (!a) continue;
        // ADVERSE POSITIVE here — the increment a fix would allocate to claims.
        const D = a.netUltimate - b.netUltimate;
        if (Math.abs(D) < 1) continue;

        const k = key(line, b.yearNumber);
        const reg = register.get(k);
        if (!reg || reg.totals.length === 0) {
          if (D > 0) devNoRegister += D;
          events.push({
            line, game: g, valYear: y, accidentYear: b.yearNumber, D,
            shareByRule: {}, registerClaims: 0, hasRegister: false, maxOccBefore: 0, maxOccAfter: 0,
          });
          continue;
        }
        if (D > 0) devWithRegister += D;

        // The live per-rule registers, created on first development and carried
        // forward from then on.
        let liveSet = live.get(k);
        if (!liveSet) {
          liveSet = Object.fromEntries(RULES.map(r => [r.name, [...reg.totals]]));
          live.set(k, liveSet);
        }

        const shareByRule: Record<string, number> = {};
        let maxAfter = 0;
        for (const rule of RULES) {
          const cur = liveSet[rule.name];
          const beforeCede = cedeOccurrences(line, cur, reg.placed);
          const delta = rule.alloc(cur, D);
          const next = cur.map((t, i) => Math.max(0, t + delta[i]));
          const afterCede = cedeOccurrences(line, next, reg.placed);
          const marginal = afterCede.totalCeded - beforeCede.totalCeded;
          shareByRule[rule.name] = marginal / D;
          cededAfterByRule[rule.name] += marginal;
          liveSet[rule.name] = next;
          if (line === 'WC') {
            const cs = capStat[rule.name];
            const mx = Math.max(...next);
            const capThisYear = WC_SEVERITY_CAP * wcSeverityTrend(b.yearNumber);
            if (mx > cs.max) cs.max = mx;
            if (mx > capThisYear) { cs.breaches++; cs.worst = Math.max(cs.worst, mx / capThisYear); }
            cs.overTop += next.filter(t => t > TOWER_TOP.WC).length > 0 ? 1 : 0;
          }
          if (rule.name === REF_RULE) {
            maxAfter = Math.max(...next);
            aboveTowerDelta += afterCede.retainedAboveTower - beforeCede.retainedAboveTower;
            grossDelta += next.reduce((s2, t) => s2 + t, 0) - cur.reduce((s2, t) => s2 + t, 0);
            if (line === 'WC') {
              const capThisYear = WC_SEVERITY_CAP * wcSeverityTrend(b.yearNumber);
              wcDevelopedMax = Math.max(wcDevelopedMax, maxAfter);
              if (maxAfter > capThisYear) {
                capBreaches++;
                capBreachWorst = Math.max(capBreachWorst, maxAfter / capThisYear);
              }
            }
          }
        }
        events.push({
          line, game: g, valYear: y, accidentYear: b.yearNumber, D, shareByRule,
          registerClaims: reg.totals.length, hasRegister: true,
          maxOccBefore: Math.max(...reg.totals), maxOccAfter: maxAfter,
        });
      }
    }

    gs = {
      ...gs, currentYearNumber: y + 1, poolState: processed.updatedPoolState,
      lockedResults: [...gs.lockedResults, processed.result], isComplete: y === YEARS,
    };
  }
}

// ---------------------------------------------------------------- reporting
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const money = (v: number) => `$${(v / 1e6).toFixed(2)}M`;
function q(sorted: number[], p: number) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

console.log('=== SIZING CLAIM-LEVEL DEVELOPMENT CESSION ===\n');
console.log(`${GAMES} games x ${YEARS} years x ${LINES.length} lines, all decisions at default (every layer placed).`);
console.log('Ceded share is MARGINAL: [cede(totals + delta) - cede(totals)] / development.\n');

const adverse = events.filter(e => e.hasRegister && e.D > 0);
const allWithReg = events.filter(e => e.hasRegister);
console.log(`${events.length.toLocaleString()} development events; ${allWithReg.length.toLocaleString()} on cohorts with a register; ${adverse.length.toLocaleString()} of those adverse.\n`);

console.log('--- CAN THE DEVELOPMENT BE ALLOCATED AT ALL? ---');
console.log('  Development on a cohort with NO claim register cannot be pushed onto claims and');
console.log('  would need a fallback. Adverse dollars only.\n');
const totalAdverse = devNoRegister + devWithRegister;
console.log(`  on cohorts WITH a register    ${money(devWithRegister).padStart(12)}   ${pct(devWithRegister / totalAdverse)}`);
console.log(`  on cohorts WITHOUT a register ${money(devNoRegister).padStart(12)}   ${pct(devNoRegister / totalAdverse)}`);
console.log('\n  Split by origin — only the seed cohorts are register-less BY CONSTRUCTION:');
const byOrigin = (f: (y: number) => boolean) =>
  events.filter(e => !e.hasRegister && e.D > 0 && f(e.accidentYear)).reduce((s, e) => s + e.D, 0);
console.log(`      seed cohorts   (<= -4)   ${money(byOrigin(y => y <= -4)).padStart(12)}   ${pct(byOrigin(y => y <= -4) / totalAdverse)}`);
console.log(`      pre-game       (-2..0)   ${money(byOrigin(y => y > -4 && y <= 0)).padStart(12)}   ${pct(byOrigin(y => y > -4 && y <= 0) / totalAdverse)}`);
console.log(`      game-born      (>= 1)    ${money(byOrigin(y => y >= 1)).padStart(12)}   ${pct(byOrigin(y => y >= 1) / totalAdverse)}`);

console.log('\n\n--- CEDED SHARE OF ADVERSE DEVELOPMENT, BY LINE AND ALLOCATION RULE ---');
console.log('  Distribution over events, not a mean. The tail is the case that matters.\n');
for (const line of LINES) {
  const rows = adverse.filter(e => e.line === line);
  if (!rows.length) continue;
  console.log(`  ${line}   (${rows.length.toLocaleString()} adverse events, mean register ${(rows.reduce((s, e) => s + e.registerClaims, 0) / rows.length).toFixed(0)} occurrences)`);
  console.log('    rule                  median       p75       p90       p99      max   |  dollar-weighted');
  for (const rule of RULES) {
    const s = rows.map(e => e.shareByRule[rule.name]).sort((a, b) => a - b);
    const dw = rows.reduce((acc, e) => acc + e.shareByRule[rule.name] * e.D, 0) / rows.reduce((acc, e) => acc + e.D, 0);
    console.log(
      `    ${rule.name.padEnd(18)} ${pct(q(s, 0.5)).padStart(8)} ${pct(q(s, 0.75)).padStart(9)} ` +
      `${pct(q(s, 0.90)).padStart(9)} ${pct(q(s, 0.99)).padStart(9)} ${pct(s[s.length - 1]).padStart(8)}   |  ${pct(dw).padStart(8)}`,
    );
  }
  console.log('');
}

console.log('\n--- SENSITIVITY: HOW MUCH DOES THE ALLOCATION RULE ACTUALLY MATTER? ---');
console.log('  Dollar-weighted ceded share per rule. If the spread is narrow the rule can be');
console.log('  chosen for how the claim register reads; if wide, the rule IS the calibration.\n');
console.log('  line       ' + RULES.map(r => r.name.padStart(17)).join(''));
for (const line of LINES) {
  const rows = adverse.filter(e => e.line === line);
  if (!rows.length) continue;
  const tot = rows.reduce((s, e) => s + e.D, 0);
  const cells = RULES.map(r => pct(rows.reduce((acc, e) => acc + e.shareByRule[r.name] * e.D, 0) / tot).padStart(17));
  console.log(`  ${line.padEnd(10)}` + cells.join(''));
}
for (const line of LINES) {
  const rows = adverse.filter(e => e.line === line);
  if (!rows.length) continue;
  const tot = rows.reduce((s, e) => s + e.D, 0);
  const vals = RULES.map(r => rows.reduce((acc, e) => acc + e.shareByRule[r.name] * e.D, 0) / tot);
  console.log(`  ${line.padEnd(10)} spread ${pct(Math.min(...vals))} to ${pct(Math.max(...vals))}  =  ${((Math.max(...vals) - Math.min(...vals)) * 100).toFixed(1)}pp`);
}

console.log('\n\n--- THE TAIL EVENTS: WHAT WOULD THE COVER HAVE DONE? ---');
console.log('  The 12 largest adverse developments, and the share each rule would have ceded.\n');
console.log('    line       game  y  AY   development   occ  maxOcc before  |  largest-1  lg-3 sized  lg-10 sized   all sized');
for (const e of [...adverse].sort((a, b) => b.D - a.D).slice(0, 12)) {
  console.log(
    `    ${e.line.padEnd(9)} ${String(e.game).padStart(4)} ${String(e.valYear).padStart(2)} ${String(e.accidentYear).padStart(3)} ` +
    `${money(e.D).padStart(13)} ${String(e.registerClaims).padStart(5)} ${money(e.maxOccBefore).padStart(14)}  |  ` +
    `${pct(e.shareByRule['largest-1']).padStart(9)} ${pct(e.shareByRule['largest-3 sized']).padStart(11)} ` +
    `${pct(e.shareByRule['largest-10 sized']).padStart(12)} ${pct(e.shareByRule['all sized']).padStart(11)}`,
  );
}

console.log('\n\n--- HOW BIG A MOVE IS THIS FOR THE TOWER? ---');
console.log('  Baseline counted ONCE per accident year; development applied cumulatively.\n');
console.log(`  gross claims written          ${money(grossBefore)}`);
console.log(`  ceded under today's tower     ${money(cededBefore)}   (${pct(cededBefore / grossBefore)} of gross)`);
console.log(`  gross added by development    ${money(grossDelta)}   (+${pct(grossDelta / grossBefore)} on gross)   [${REF_RULE}]`);
console.log(`  extra ceded                   ${money(cededAfterByRule[REF_RULE])}   (+${pct(cededAfterByRule[REF_RULE] / cededBefore)} on E[ceded])`);
console.log(`  extra retained above tower    ${money(aboveTowerDelta)}`);
console.log('\n  Per rule — the range a tower re-derivation would have to span:');
console.log('    rule                 extra ceded   uplift on E[ceded]   extra ceded as % of gross');
for (const r of RULES) {
  console.log(
    `    ${r.name.padEnd(18)} ${money(cededAfterByRule[r.name]).padStart(13)} ` +
    `${('+' + pct(cededAfterByRule[r.name] / cededBefore)).padStart(20)} ${pct(cededAfterByRule[r.name] / grossBefore).padStart(27)}`,
  );
}

console.log('\n\n--- CAN A DEVELOPED CLAIM BREACH WC\'S SEVERITY CAP? ---');
console.log(`  WC_SEVERITY_CAP is ${money(WC_SEVERITY_CAP)} in year 1, trended by wcSeverityTrend.`);
console.log('  The cap is applied AT THE DRAW, so a claim developing past it is a state that does');
console.log('  not currently exist anywhere in the model.\n');
console.log(`  WC tower top is ${money(TOWER_TOP.WC)}, so anything above it is retained unlimited.\n`);
console.log('    rule                largest WC occ   cap breaches   worst breach   events with an occ over tower top');
for (const r of RULES) {
  const cs = capStat[r.name];
  console.log(
    `    ${r.name.padEnd(18)} ${money(cs.max).padStart(14)} ${String(cs.breaches).padStart(14)} ` +
    `${(cs.breaches ? cs.worst.toFixed(2) + 'x' : '-').padStart(14)} ${String(cs.overTop).padStart(35)}`,
  );
}
void wcDevelopedMax; void capBreaches; void capBreachWorst;
