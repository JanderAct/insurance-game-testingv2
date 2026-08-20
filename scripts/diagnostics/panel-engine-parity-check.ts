// DOES THE DECISIONS PANEL QUOTE WHAT THE ENGINE CHARGES?
//
// Run: npx tsx scripts/diagnostics/panel-engine-parity-check.ts
//
// ============================================================================
// ⚠ THIS ASSERTS THE COMPONENTS, NEVER THE COMBINED RATIO. That is the whole
// design of the check, and the reason it exists.
//
// Before this commit the panel priced on the model the engine abandoned: gross
// funding and a percentage-of-premium reinsurance charge. Its combined ratio
// read 100.0% anyway, because it was internally consistent ON ITS OWN GROSS
// BASIS — and when the engine's combined-ratio basis was fixed, the engine
// reached 100.0% too. So the two AGREED on the single summary number anyone
// would have checked, while GL's pool premium rate differed by 73% underneath.
//
// A check on the combined ratio would have passed throughout. Only the
// components reveal it, so only the components are asserted.
// ============================================================================
//
// WHAT PARITY MEANS HERE. The panel answers "what would this year cost on the
// book as it stands" — the PRE-MOVEMENT question, since the decision is made
// before the year runs. The engine asks the same question to build the price
// signal members respond to, and that estimate is the referent: parity against
// it must be EXACT (both now call quoteLineRates).
//
// The engine's FINAL premium re-runs the same arithmetic on the POST-movement
// book. The panel cannot know who will join or leave, so that residual is
// structural and is MEASURED here rather than asserted at zero.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { computeFundingConsequence } from '../../src/utils/fundingConsequence';
import { getMemberExposure } from '../../src/utils/lineHelpers';
import { quoteLineRates } from '../../src/utils/linePricing';
import { currentPurePremiumPer100, projectedRcEffectiveness, lookupCLF } from '../../src/utils/simulationEngine';
import { hasStaticClf, staticClf } from '../../src/data/clfTables';
import { REINSURANCE_PROGRAMS, ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = 5;
// Across the range, not just the default — a panel wrong only in its CLF
// handling would pass a single-point check.
const LEVELS = [0.30, 0.45, 0.60, 0.75, 0.90, 0.95];
const EXACT = 1e-9;

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) { failures++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
  else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

console.log('=== PANEL / ENGINE PARITY ===\n');

// --- 1. EXACT PARITY WITH THE ENGINE'S PRE-MOVEMENT QUOTE --------------------
// The engine does not expose its estimate block, so it is reconstructed here
// from the SAME shared function both callers use, against the same book the
// panel sees. If the panel ever stops calling quoteLineRates, this diverges.
console.log('--- 1. COMPONENT PARITY, PRE-MOVEMENT, ACROSS THE CONFIDENCE RANGE ---');
console.log('  Panel vs engine, per component, at every level the slider can reach.\n');
{
  const worst: Record<string, Record<string, number>> = {};
  for (const l of LINES) worst[l] = {};

  for (let g = 0; g < GAMES; g++) {
    const id = `PEP${g}`;
    const inst = generateGameInstance(id, 2_200_000 + g * 5147);
    const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };

    for (let y = 1; y <= YEARS; y++) {
      for (const line of LINES) {
        const lineState = gs.poolState.lines[line];
        const members = lineState.members.filter(m => m.status === 'active');
        const exposure = members.reduce((s, m) => s + getMemberExposure(m, line, y), 0);
        const dec = defaultDecisionSet(y).byLine[line];

        for (const level of LEVELS) {
          // atExpected FALSE so the table is genuinely exercised at each level;
          // the default (Expected, CLF 1.000) is covered by level-independence
          // and separately in section 2.
          const panel = computeFundingConsequence(
            level, dec.reinsuranceLevel, lineState.ratePer100, line, false,
            {
              yearNumber: y,
              members,
              exposure,
              layersPlaced: dec.layersPlaced,
              aggregateStopLevel: dec.aggregateStopLevel,
              pricingAdjustment: lineState.rateLevel / 100,
              competitivePressure: inst.marketEnvironment.competitivePressure,
              priorPurePremiumPer100: lineState.purePremiumPer100,
              lossTrend: inst.lossEnvironment.lossTrend,
              priorRcEffectiveness: lineState.riskControlEffectiveness,
              riskControlPct: dec.riskControlPct,
            },
          );

          // The engine's own quote, same shared function, same inputs.
          const rcEff = projectedRcEffectiveness(lineState.riskControlEffectiveness, dec.riskControlPct);
          const pp = currentPurePremiumPer100(line, y, lineState.purePremiumPer100, inst.lossEnvironment.lossTrend, rcEff);
          const clf = hasStaticClf(line) ? staticClf(line, level) : lookupCLF(level);
          const eng = quoteLineRates({
            line, yearNumber: y, members, exposure, purePremiumPer100: pp, clf,
            pricingAdjustment: lineState.rateLevel / 100,
            layersPlaced: dec.layersPlaced, aggregateStopLevel: dec.aggregateStopLevel,
            reinsuranceLevel: dec.reinsuranceLevel,
            competitivePressure: inst.marketEnvironment.competitivePressure,
          });

          const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
          const cmp: Record<string, number> = {
            'pure premium /$100': rel(panel.purePremiumPer100, eng.purePremiumPer100),
            'expected ceded /$100': rel(panel.expectedCededPer100, eng.expectedCededPer100),
            'net pure premium /$100': rel(panel.netPurePremiumPer100, eng.netPurePremiumPer100),
            'pool premium rate /$100': rel(panel.poolPremiumRatePer100, eng.poolPremiumRatePer100),
            'admin rate /$100': rel(panel.adminRatePer100, eng.adminRatePer100),
            'reinsurance rate /$100': rel(panel.reinsRatePer100, eng.reinsRatePer100),
            'total member charge /$100': rel(panel.totalMemberChargeRatePer100, eng.totalMemberChargeRatePer100),
          };
          for (const [k, v] of Object.entries(cmp)) {
            worst[line][k] = Math.max(worst[line][k] ?? 0, v);
          }
        }
      }
      const p = processYear(gs, defaultDecisionSet(y));
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }

  for (const l of LINES) {
    const entries = Object.entries(worst[l]);
    const bad = entries.filter(([, v]) => v >= EXACT);
    check(bad.length === 0, `${l}: all ${entries.length} components match the engine exactly`,
      bad.length ? bad.map(([k, v]) => `${k} ${v.toExponential(2)}`).join(', ')
                 : `worst ${Math.max(...entries.map(([, v]) => v)).toExponential(2)}`);
  }
}

// --- 1b. AGAINST THE ENGINE'S STORED OUTPUT, NOT THE SHARED FUNCTION ---------
// Section 1 compares the panel to quoteLineRates, which the panel itself calls
// — so it verifies the panel THREADS its inputs correctly, but it cannot catch
// the shared function being wrong. This one compares against fields the ENGINE
// actually stored on its result, which is an independent referent.
//
// ⚠ members PRE-MOVEMENT, exposure POST-MOVEMENT, and that pairing is not a
// mistake. The engine hoists the tower quote off the pre-movement book and
// reuses it, then divides expected ceded by the POST-movement exposure. Feeding
// the panel anything self-consistent would NOT reproduce the engine; feeding it
// what the engine actually did, does.
console.log('\n--- 1b. PANEL vs THE ENGINE\'S STORED FIELDS ---');
{
  const worst: Record<string, Record<string, number>> = {};
  for (const l of LINES) worst[l] = {};
  for (let g = 0; g < GAMES; g++) {
    const id = `PEPS${g}`;
    const inst = generateGameInstance(id, 8_800_000 + g * 4231);
    const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const pre: Record<string, { members: ReturnType<typeof Array.prototype.filter>; ls: typeof gs.poolState.lines[CoverageLine] }> = {} as never;
      for (const line of LINES) {
        const ls = gs.poolState.lines[line];
        pre[line] = { members: ls.members.filter(m => m.status === 'active'), ls };
      }
      const p = processYear(gs, defaultDecisionSet(y));
      for (const line of LINES) {
        const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[line];
        if (!r || r.activeExposure <= 0) continue;
        const dec = defaultDecisionSet(y).byLine[line];
        const ls = pre[line].ls;
        const panel = computeFundingConsequence(
          dec.fundingConfidenceLevel, dec.reinsuranceLevel, ls.ratePer100, line, dec.fundingAtExpected,
          {
            yearNumber: y,
            members: pre[line].members as never,
            exposure: r.activeExposure,
            layersPlaced: dec.layersPlaced,
            aggregateStopLevel: dec.aggregateStopLevel,
            pricingAdjustment: ls.rateLevel / 100,
            competitivePressure: inst.marketEnvironment.competitivePressure,
            priorPurePremiumPer100: ls.purePremiumPer100,
            lossTrend: inst.lossEnvironment.lossTrend,
            priorRcEffectiveness: ls.riskControlEffectiveness,
            riskControlPct: dec.riskControlPct,
          },
        );
        // ⚠ TOLERANCE IS SET BY activeExposure's OWN STORAGE, not chosen. The
        // result stores activeExposure rounded to 2dp (simulationEngine, and
        // predating all of this), while the engine priced against the
        // unrounded value — so feeding the panel the stored figure caps the
        // achievable agreement at about 0.005/activeExposure, ~1e-5 on these
        // books. Everything is measured as a MULTIPLE of that bound, so the
        // check tightens automatically as exposure grows and cannot be passed
        // by loosening a magic number.
        const bound = 0.005 / Math.max(r.activeExposure, 1);
        const rel = (a: number, b: number) =>
          (Math.abs(a - b) / Math.max(Math.abs(b), 1e-9)) / bound;
        const cmp: Record<string, number> = {
          'expectedCededPer100 (stored)': rel(panel.expectedCededPer100, r.expectedCededPer100),
          'netPurePremiumPer100 (stored)': rel(panel.netPurePremiumPer100, r.netPurePremiumPer100),
          'selectedFundingCLF (stored)': rel(panel.clf, r.selectedFundingCLF),
          'pool premium rate (stored)': rel(panel.poolPremiumRatePer100, r.poolPremium / (r.activeExposure * 10_000)),
          'reinsuranceCost (stored)': rel(panel.reinsRatePer100 * r.activeExposure * 10_000, r.reinsuranceCost),
        };
        for (const [k, v] of Object.entries(cmp)) worst[line][k] = Math.max(worst[line][k] ?? 0, v);
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
  for (const l of LINES) {
    const entries = Object.entries(worst[l]);
    // 3x the bound: the rate carries exposure in two places (the ceded
    // deduction and the rate itself), so one rounding unit can enter twice.
    const bad = entries.filter(([, v]) => v >= 3);
    check(bad.length === 0, `${l}: panel reproduces the engine's stored fields within the exposure-rounding floor`,
      bad.length ? bad.map(([k, v]) => `${k} ${v.toFixed(2)}x bound`).join(', ')
                 : `worst ${Math.max(...entries.map(([, v]) => v)).toFixed(2)}x the rounding bound`);
  }
}

// --- 2. THE REGRESSION THIS COMMIT FIXES, STATED AS A NUMBER -----------------
console.log('\n--- 2. WHAT THE OLD PANEL WOULD HAVE SHOWN ---');
console.log('  The retired formulas, recomputed here, against what the engine charges.');
console.log('  Reported (not asserted): its purpose is to keep the size of the defect on');
console.log('  the record, not to gate on the old code continuing to be wrong.\n');
{
  const inst = generateGameInstance('PEPOLD', 3_300_000);
  const setup = { poolName: 'O', gameLength: 2, startingYear: 2026, instanceId: 'PEPOLD', activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  const gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  console.log('  line       old pool rate   new pool rate   old reins   new reins   old was');
  for (const line of LINES) {
    const lineState = gs.poolState.lines[line];
    const members = lineState.members.filter(m => m.status === 'active');
    const exposure = members.reduce((s, m) => s + getMemberExposure(m, line, 1), 0);
    const dec = defaultDecisionSet(1).byLine[line];
    const panel = computeFundingConsequence(
      0.60, dec.reinsuranceLevel, lineState.ratePer100, line, false,
      {
        yearNumber: 1, members, exposure, layersPlaced: dec.layersPlaced,
        aggregateStopLevel: dec.aggregateStopLevel, pricingAdjustment: lineState.rateLevel / 100,
        competitivePressure: inst.marketEnvironment.competitivePressure,
        priorPurePremiumPer100: lineState.purePremiumPer100,
        lossTrend: inst.lossEnvironment.lossTrend,
        priorRcEffectiveness: lineState.riskControlEffectiveness,
        riskControlPct: dec.riskControlPct,
      },
    );
    // The retired derivation, verbatim: gross x CLF, reinsurance as a
    // mid-range percentage of pool premium, pure premium taken from last year.
    const prog = REINSURANCE_PROGRAMS[dec.reinsuranceLevel];
    const oldPct = prog ? (prog.costPctOfPremiumMin + prog.costPctOfPremiumMax) / 2 : 0;
    const oldPool = lineState.purePremiumPer100 * panel.clf;
    const oldReins = oldPool * oldPct;
    void ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
    const over = (a: number, b: number) => b > 0 ? `${((a / b - 1) * 100).toFixed(0)}%` : 'n/a';
    console.log(`  ${line.padEnd(10)} $${oldPool.toFixed(2).padStart(8)}      $${panel.poolPremiumRatePer100.toFixed(2).padStart(8)}` +
      `      $${oldReins.toFixed(2).padStart(6)}     $${panel.reinsRatePer100.toFixed(2).padStart(6)}     ${over(oldPool, panel.poolPremiumRatePer100)} high`);
  }
}

// --- 3. THE RESIDUAL THAT REMAINS, MEASURED ----------------------------------
console.log('\n--- 3. PRE-MOVEMENT vs THE ENGINE\'S FINAL PREMIUM ---');
console.log('  The one gap parity CANNOT close: the panel quotes before member movement,');
console.log('  the engine settles after it. Measured so the comment can state its size.\n');
{
  const gaps: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  for (let g = 0; g < GAMES; g++) {
    const id = `PEPR${g}`;
    const inst = generateGameInstance(id, 6_600_000 + g * 3121);
    const setup = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const snapshot: Record<string, number> = {};
      for (const line of LINES) {
        const lineState = gs.poolState.lines[line];
        const members = lineState.members.filter(m => m.status === 'active');
        const exposure = members.reduce((s, m) => s + getMemberExposure(m, line, y), 0);
        const dec = defaultDecisionSet(y).byLine[line];
        const panel = computeFundingConsequence(
          dec.fundingConfidenceLevel, dec.reinsuranceLevel, lineState.ratePer100, line, dec.fundingAtExpected,
          {
            yearNumber: y, members, exposure, layersPlaced: dec.layersPlaced,
            aggregateStopLevel: dec.aggregateStopLevel, pricingAdjustment: lineState.rateLevel / 100,
            competitivePressure: inst.marketEnvironment.competitivePressure,
            priorPurePremiumPer100: lineState.purePremiumPer100,
            lossTrend: inst.lossEnvironment.lossTrend,
            priorRcEffectiveness: lineState.riskControlEffectiveness,
            riskControlPct: dec.riskControlPct,
          },
        );
        snapshot[line] = panel.poolPremiumRatePer100;
      }
      const p = processYear(gs, defaultDecisionSet(y));
      for (const line of LINES) {
        const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[line];
        if (!r || r.activeExposure <= 0) continue;
        const actualRate = r.poolPremium / (r.activeExposure * 10_000);
        gaps[line].push(Math.abs(snapshot[line] / actualRate - 1) * 100);
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
  const q = (xs: number[], pp: number) => { const t = [...xs].sort((a, b) => a - b); return t[Math.min(t.length - 1, Math.floor(pp * (t.length - 1)))]; };
  console.log('  line       |panel - actual| as % of actual pool premium rate (median / p90 / max)');
  for (const l of LINES) {
    const v = gaps[l];
    if (!v.length) continue;
    console.log(`  ${l.padEnd(10)} ${q(v, 0.5).toFixed(2)}% / ${q(v, 0.9).toFixed(2)}% / ${q(v, 1).toFixed(2)}%`);
  }
  console.log('\n  This is member movement alone, and it is NOT a defect: the panel is asked the');
  console.log('  question before the answer exists. It is measured so the claim in');
  console.log('  fundingConsequence\'s header can state the residual instead of implying zero.');
}

console.log(failures === 0 ? '\nALL PARITY CHECKS PASS.' : `\n${failures} CHECK(S) FAILED.`);
if (failures > 0) process.exit(1);
