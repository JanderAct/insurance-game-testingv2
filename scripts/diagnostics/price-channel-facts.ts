// PRICE CHANNEL — the facts, measured before anything is wired.
//
// Run: npx tsx scripts/diagnostics/price-channel-facts.ts
//
// Three things have to be known before a scale can be chosen rather than
// asserted:
//
//   1. THE NEUTRAL POINT IS PER LINE AND NON-ZERO. At all-default decisions
//      each line's total member charge rate already moves on its trends alone
//      — WC's falls, GL's rises, Property's does its own thing. Any penalty
//      applied to the raw rate change would therefore be a permanent tax on
//      one line and a permanent subsidy to another, at DEFAULTS, before a
//      player has done anything.
//
//   2. THE RATE LEVEL AT DEFAULTS. Rate CHANGE cannot see a pool that has been
//      overpriced for five years; only the LEVEL can. The level is measured
//      here as the load — total member charge rate over pure premium rate —
//      which is the scale-free form, comparable across lines and years.
//
//   3. WHAT THE TOWER ACTUALLY COSTS, in both of those currencies. This is the
//      thing the whole change is for: buying GL's full tower is supposed to be
//      a visible price event.
//
// REPORTS. Changes nothing.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = 30, YEARS = 10;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

type Row = { rate: number; pure: number; prevRate: number | null; year: number };

function run(towerOn: boolean): Record<string, Row[]> {
  const out: Record<string, Row[]> = { WC: [], GL: [], Property: [] };
  for (let g = 0; g < GAMES; g++) {
    const id = `PCF${g}`;
    const inst = generateGameInstance(id, 7_700_000 + g * 5171);
    const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    } as never as GameState;

    for (let y = 1; y <= YEARS; y++) {
      // ⚠ DEFAULT_LAYERS_PLACED already places every purchasable layer, so the
      // DEFAULT decision set IS the full tower. The contrast arm is the one
      // that has to be constructed: strip every layer explicitly.
      const d = defaultDecisionSet(y);
      // ⚠ ALL THREE LINES. This looped ['WC', 'GL'] until Property got its own
      // occurrence layer, which was correct then (Property was on
      // REINSURANCE_PROGRAMS, which layersPlaced does not control) and became
      // silently WRONG the moment it was not: Property kept its tower ON in
      // BOTH arms, so its "no tower" column was really "tower on" and its load
      // read 1.5176 where a genuinely un-reinsured line reads 1.1500.
      for (const l of LINES) {
        d.byLine[l].layersPlaced = REINSURANCE_TOWER[l].map(() => towerOn);
      }
      // prior rate as the ENGINE sees it: lineState.ratePer100 is last year's
      // totalMemberRatePer100, the same field fundingConsequence compares against.
      const prior: Record<string, number> = {};
      for (const l of LINES) {
        prior[l] = (gs.poolState as never as {
          lines: Record<string, { ratePer100: number }>
        }).lines[l].ratePer100;
      }
      const p = processYear(gs, d);
      for (const l of LINES) {
        const r = (p.result as never as {
          byLine: Record<string, { ratePer100: number; purePremiumPer100: number }>
        }).byLine[l];
        if (!r) continue;
        out[l].push({ rate: r.ratePer100, pure: r.purePremiumPer100, prevRate: prior[l] > 0 ? prior[l] : null, year: y });
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
  return out;
}

console.log('=== PRICE CHANNEL FACTS — all-default decisions, 30 games x 10 years ===\n');

// BOTH ARMS UP FRONT. The constants RATE_NEUTRAL_CHANGE_PCT and
// RATE_NEUTRAL_LOAD are defined AT DEFAULTS, and the default decision set
// places every purchasable layer — so the arm they must be read from is the
// TOWER arm, not the contrast arm. Sections 2 and 3 used to read `noTower`,
// which was right for neither line: WC/GL's constants are tower-on values and
// Property was never stripped at all.
const noTower = run(false);
const tower = run(true);

console.log('--- 1. IS THERE A PRIOR RATE IN YEAR 1? ---');
console.log('  (the pre-game runs 3 years through the same engine, so year 1 should have one)');
for (const l of LINES) {
  const y1 = noTower[l].filter(r => r.year === 1);
  const withPrior = y1.filter(r => r.prevRate !== null).length;
  console.log(`  ${l.padEnd(9)} year-1 line-instances with a prior rate: ${withPrior}/${y1.length}`);
}

console.log('\n--- 2. THE NEUTRAL RATE CHANGE, PER LINE (AT DEFAULTS = full tower placed) ---');
console.log('  This is what a player who does NOTHING already experiences.\n');
console.log('  line       mean %/yr   median %/yr   p10      p90');
const neutral: Record<string, number> = {};
for (const l of LINES) {
  const ch = tower[l].filter(r => r.prevRate !== null)
    .map(r => (r.rate / (r.prevRate as number) - 1) * 100);
  neutral[l] = mean(ch);
  console.log(`  ${l.padEnd(10)} ${mean(ch).toFixed(3).padStart(9)} ${q(ch, 0.5).toFixed(3).padStart(13)} ` +
    `${q(ch, 0.1).toFixed(2).padStart(8)} ${q(ch, 0.9).toFixed(2).padStart(8)}`);
}
console.log('\n  ⚠ These are the per-line neutral points. A penalty applied to the RAW rate change');
console.log('  would tax whichever line trends up and subsidise whichever trends down, at defaults.');

console.log('\n--- 3. THE RATE LEVEL AT DEFAULTS, tower placed (load = total member charge rate / pure premium rate) ---');
console.log('  line       mean load   median   p10     p90');
for (const l of LINES) {
  const ld = tower[l].filter(r => r.pure > 0).map(r => r.rate / r.pure);
  console.log(`  ${l.padEnd(10)} ${mean(ld).toFixed(4).padStart(9)} ${q(ld, 0.5).toFixed(4).padStart(8)} ` +
    `${q(ld, 0.1).toFixed(3).padStart(7)} ${q(ld, 0.9).toFixed(3).padStart(7)}`);
}

console.log('\n--- 4. WHAT THE FULL TOWER COSTS, in both currencies ---');
console.log('  line       rate/$100 no tower -> full tower   level increase   one-off rate change in Y1');
for (const l of LINES) {
  const a = mean(noTower[l].map(r => r.rate));
  const b = mean(tower[l].map(r => r.rate));
  const y1a = mean(noTower[l].filter(r => r.year === 1).map(r => r.rate));
  const y1b = mean(tower[l].filter(r => r.year === 1).map(r => r.rate));
  const y1prior = mean(noTower[l].filter(r => r.year === 1 && r.prevRate !== null).map(r => r.prevRate as number));
  console.log(`  ${l.padEnd(10)} ${a.toFixed(2).padStart(11)} -> ${b.toFixed(2).padStart(6)}` +
    `${((b / a - 1) * 100).toFixed(1).padStart(21)}%   ` +
    `${((y1b / y1prior - 1) * 100).toFixed(1).padStart(6)}% vs ${((y1a / y1prior - 1) * 100).toFixed(1)}% without`);
}
console.log('\n  loads, no tower -> tower on:');
for (const l of LINES) {
  const ld = tower[l].filter(r => r.pure > 0).map(r => r.rate / r.pure);
  const ld0 = noTower[l].filter(r => r.pure > 0).map(r => r.rate / r.pure);
  console.log(`    ${l.padEnd(8)} ${mean(ld0).toFixed(4)} -> ${mean(ld).toFixed(4)}`);
}

console.log('\n--- 5. RATE CHANGE IN THE TOWER ARM, BY YEAR (is it a one-off or permanent?) ---');
console.log('  If the tower is bought in year 1 and held, the LEVEL stays high forever but the');
console.log('  CHANGE should spike once and then return to the line\'s neutral. That is exactly');
console.log('  why level and change must drive different things.\n');
console.log('  year   GL change %/yr (tower)   GL change %/yr (no tower)');
for (let y = 1; y <= YEARS; y++) {
  const t = tower.GL.filter(r => r.year === y && r.prevRate !== null)
    .map(r => (r.rate / (r.prevRate as number) - 1) * 100);
  const n = noTower.GL.filter(r => r.year === y && r.prevRate !== null)
    .map(r => (r.rate / (r.prevRate as number) - 1) * 100);
  console.log(`  Y${String(y).padStart(2)}    ${mean(t).toFixed(2).padStart(20)}   ${mean(n).toFixed(2).padStart(24)}`);
}

console.log('\nDONE — facts only. Nothing changed.');
