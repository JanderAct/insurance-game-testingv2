// ============================================================================
// THE MEMBER EXPERIENCE MODIFIER — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/member-experience-mod-check.ts
//   GAMES=4 YEARS=6 npx tsx scripts/diagnostics/member-experience-mod-check.ts
//
// The modifier moves money BETWEEN members and must move nothing else. Five
// assertions, and three of them are about what it must NOT touch.
//
// ============================================================================
// 1. THE REBASE HOLDS: exposure-weighted mean mod is exactly 1.
//
// The cap moves the mean by construction — clamping a right-skewed ratio at
// [0.5, 3.0] pulls its mean well below 1 — and the rebase is what puts it
// back. So this is not a property to note, it is the one the cap creates a
// need for.
//
// ⚠ WITH A POSITIVE CONTROL, to the same standard as reserve-centring-check
// and for the same reason: a centring assertion that has never been shown to
// reject an off-centre input is not a centring assertion. A deliberate 5%
// off-balance is injected and must be rejected.
//
// 2. IT DOES NOT REACH THE POOL TOTAL, RETENTION, OR THE RATE.
//
// Perturbed by scaling CREDIBILITY_Z tenfold — the real constant, mutated in
// this process before the engine runs, so the engine's own path is exercised
// rather than a re-derivation of it. poolPremium, activeExposure, the
// enrolled roster, the retention rate and the rate per $100 must all be
// bit-identical; only the allocation may move.
//
//   THE POOL TOTAL because this is an allocation. It holds by construction —
//     the mod enters as a weight and weights are normalised — and is asserted
//     anyway, because "by construction" is an argument and this is a
//     measurement. Same standard the class rates were held to.
//   RETENTION because member premium -> who stays -> the enrolled mix -> the
//     blended rate -> the pool rate is a feedback loop the pool must not
//     acquire by accident.
//   THE RATE because the pool prices at NEUTRAL risk quality deliberately. A
//     modifier feeding back into it is finding 17 arriving through
//     underwriting.
//
// ⚠ AND IT FAILS IF THE PERTURBATION MOVES NO ALLOCATION, the same
// inert-probe guard member-premium-check carries. A probe that cannot move
// the thing it perturbs is not a control.
//
// 3. IT CANNOT SEE THE YEAR IT IS PRICING.
//
// processYear records a year into the ledger AFTER processLineYear returns,
// so the mod for year N reads years N-3..N-1. Asserted by recomputing the mod
// from the ledger AS IT STOOD AT THE END OF YEAR N-1 and requiring a bit-exact
// match with what the engine used in year N — and, as its own control, by
// requiring that the same recomputation INCLUDING year N gives a different
// answer. Without that second clause the first would pass on a ledger that
// never changed.
//
// 4. THE MOD STAYS INSIDE THE BAND ITS CONFIGURATION ALLOWS.
//
// 5. UNRATED MEMBERS SIT AT EXACTLY 1. Not approximately: a member with too
// little history is not being rated, and a mod of 0.9997 would mean they were
// being charged for an opinion the design says it does not have.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import {
  CREDIBILITY_Z, EXPERIENCE_MOD, memberExperienceMods, modBounds,
} from '../../src/utils/memberExperienceMod';
import type {
  CoverageLine, GameState, Member, MemberLossHistory, MemberPremiumShare,
} from '../../src/types/simulation';

const RULE = '='.repeat(76);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 6);
const YEARS = Number(process.env.YEARS ?? 10);

// The rebase is a division by an exposure-weighted mean, so the residual is
// float noise over ~60 members rather than zero.
const MEAN_TOL = 1e-12;
// The injected off-balance for the positive control.
const CONTROL_OFFBALANCE = 0.05;

const failures: string[] = [];

interface Snap {
  enrolledIds: string;
  activeExposure: number;
  retention: number;
  poolPremium: number;
  ratePer100: number;
  shares: MemberPremiumShare[];
  members: Member[];
  /** the ledger as it stood BEFORE this year was processed */
  historyBefore: MemberLossHistory;
  /** and after */
  historyAfter: MemberLossHistory;
}

function runGame(g: number): Map<string, Snap> {
  const id = `XM${g}`;
  const instance = generateGameInstance(id, 84_000_000 + g * 6329);
  const setup = { poolName: 'X', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out = new Map<string, Snap>();
  for (let y = 1; y <= YEARS; y++) {
    // ⚠ DEEP-COPIED BEFORE THE YEAR RUNS. processYear clones internally, but
    // the object reachable from gs is the one it started from and asserting
    // against a live reference would silently compare the year to itself.
    const before = JSON.parse(JSON.stringify(gs.poolState.memberLossHistory ?? {})) as MemberLossHistory;
    const p = processYear(gs, defaultDecisionSet(y));
    const after = JSON.parse(JSON.stringify(p.updatedPoolState.memberLossHistory ?? {})) as MemberLossHistory;
    for (const lr of p.lineResults) {
      const line = lr.line as CoverageLine;
      const x = lr.result as never as Record<string, unknown>;
      out.set(`${line}|${y}`, {
        enrolledIds: ((x.memberList ?? []) as Member[]).map(m => m.id).sort().join(','),
        activeExposure: x.activeExposure as number,
        retention: x.memberRetentionRate as number,
        poolPremium: x.poolPremium as number,
        ratePer100: x.rateAtConfidenceLevelPer100 as number,
        shares: (x.memberPremiumShares ?? []) as MemberPremiumShare[],
        members: (x.memberList ?? []) as Member[],
        historyBefore: before,
        historyAfter: after,
      });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return out;
}

console.log(RULE);
console.log('THE MEMBER EXPERIENCE MODIFIER');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years. window ${EXPERIENCE_MOD.windowYears}yr, `
  + `ratio clamped to [${EXPERIENCE_MOD.ratioFloor}, ${EXPERIENCE_MOD.ratioCeiling}], `
  + `Z ` + LINES.map(l => `${l} ${CREDIBILITY_Z[l]}`).join(' / '));

const base: Array<Map<string, Snap>> = [];
for (let g = 0; g < GAMES; g++) base.push(runGame(g));

// ------------------------------------------------------------ 1. the rebase
console.log('\n--- 1. THE REBASE: exposure-weighted mean mod is 1 ---');
{
  let worst = 0, checked = 0, nonTrivial = 0;
  const perLine: Record<string, number> = {};
  for (const game of base) {
    for (const [key, s] of game) {
      if (s.shares.length === 0) continue;
      let wm = 0, we = 0;
      for (const r of s.shares) { wm += r.exposure * r.experienceMod; we += r.exposure; }
      if (!(we > 0)) continue;
      const d = Math.abs(wm / we - 1);
      worst = Math.max(worst, d);
      perLine[key.split('|')[0]] = Math.max(perLine[key.split('|')[0]] ?? 0, d);
      nonTrivial += s.shares.filter(r => r.experienceMod !== 1).length;
      checked++;
    }
  }
  console.log(`  ${checked} line-years, ${nonTrivial} member-rows with a mod other than 1`);
  for (const l of LINES) console.log(`    ${l.padEnd(9)} worst |mean - 1| = ${(perLine[l] ?? 0).toExponential(2)}`);
  console.log(`  worst overall = ${worst.toExponential(2)} against ${MEAN_TOL.toExponential(0)}   ${worst <= MEAN_TOL ? 'PASS' : 'FAIL'}`);
  if (worst > MEAN_TOL) {
    failures.push(`the exposure-weighted mean mod is off 1 by ${worst.toExponential(2)}. The cap pulls the raw `
      + 'ratio mean well below 1 by construction, so the rebase is the only thing holding this — an off-centre '
      + 'mean means the modifier is quietly re-pricing the book rather than redistributing within it.');
  }
  if (nonTrivial === 0) {
    failures.push('every member carries a mod of exactly 1, so assertion 1 is centring a constant. Either no '
      + 'member reaches the minimum history or the mod is not reaching the allocation.');
  }

  // POSITIVE CONTROL — a deliberate 5% off-balance must be rejected.
  let controlRejected = 0, controlTotal = 0;
  for (const game of base) {
    for (const s of game.values()) {
      if (s.shares.length === 0) continue;
      let wm = 0, we = 0;
      for (const r of s.shares) { wm += r.exposure * r.experienceMod * (1 + CONTROL_OFFBALANCE); we += r.exposure; }
      controlTotal++;
      if (Math.abs(wm / we - 1) > MEAN_TOL) controlRejected++;
    }
  }
  const controlOk = controlRejected === controlTotal;
  console.log(`  POSITIVE CONTROL: every mod scaled by ${(1 + CONTROL_OFFBALANCE).toFixed(2)} -> `
    + `${controlRejected}/${controlTotal} line-years rejected   ${controlOk ? 'PASS' : 'FAIL'}`);
  if (!controlOk) {
    failures.push(`the positive control did not fire: a deliberate ${CONTROL_OFFBALANCE * 100}% off-balance was `
      + `rejected in only ${controlRejected} of ${controlTotal} line-years. The centring assertion above cannot `
      + 'be trusted — it has not been shown to reject an off-centre input.');
  }
}

// -------------------------------------- 2. it reaches nothing but the split
console.log('\n--- 2. IT REACHES NOTHING BUT THE SPLIT (Z scaled x10 in-process) ---');
{
  const originals = { ...CREDIBILITY_Z };
  for (const l of LINES) CREDIBILITY_Z[l] = originals[l] * 10;
  const pert: Array<Map<string, Snap>> = [];
  try {
    for (let g = 0; g < GAMES; g++) pert.push(runGame(g));
  } finally {
    for (const l of LINES) CREDIBILITY_Z[l] = originals[l];
  }

  let compared = 0, leaked = 0, allocationMoved = 0, modMoved = 0;
  for (let g = 0; g < GAMES; g++) {
    for (const [key, b] of base[g]) {
      const p = pert[g].get(key);
      if (!p) { leaked++; continue; }
      compared++;
      const same = b.enrolledIds === p.enrolledIds
        && b.activeExposure === p.activeExposure
        && b.retention === p.retention
        && b.poolPremium === p.poolPremium
        && b.ratePer100 === p.ratePer100;
      if (!same) {
        leaked++;
        if (leaked <= 3) {
          failures.push(`${key}: scaling credibility moved something outside the allocation — `
            + `enrolled ${b.enrolledIds === p.enrolledIds ? 'same' : 'DIFFERENT'}, `
            + `exposure ${b.activeExposure === p.activeExposure ? 'same' : `${b.activeExposure} vs ${p.activeExposure}`}, `
            + `retention ${b.retention === p.retention ? 'same' : `${b.retention} vs ${p.retention}`}, `
            + `poolPremium ${b.poolPremium === p.poolPremium ? 'same' : `${b.poolPremium} vs ${p.poolPremium}`}, `
            + `rate ${b.ratePer100 === p.ratePer100 ? 'same' : `${b.ratePer100} vs ${p.ratePer100}`}. `
            + 'The experience modifier is an ALLOCATION: it may change who pays and must change nothing about '
            + 'what the pool charges, what it collects, or who is in the book.');
        }
      }
      if (b.shares.some((s, i) => s.premium !== p.shares[i]?.premium)) allocationMoved++;
      if (b.shares.some((s, i) => s.experienceMod !== p.shares[i]?.experienceMod)) modMoved++;
    }
  }
  console.log(`  ${compared} line-years compared`);
  console.log(`  line-years whose MOD moved: ${modMoved}  (must be > 0, or the probe is inert)`);
  console.log(`  line-years whose ALLOCATION moved: ${allocationMoved}  (must be > 0)`);
  console.log(`  line-years that LEAKED outside the allocation: ${leaked}  (must be 0)   `
    + `${leaked === 0 && modMoved > 0 && allocationMoved > 0 ? 'PASS' : 'FAIL'}`);
  if (modMoved === 0 || allocationMoved === 0) {
    failures.push('scaling credibility tenfold changed no mod or no allocation, so assertion 2 proved nothing. '
      + 'A probe that cannot move the thing it perturbs is not a control — see WORKING_PRACTICES on the '
      + 'absurd-value probe. Check that CREDIBILITY_Z is the object the engine actually reads.');
  }
}

// ------------------------------------------------- 3. no lookahead
console.log('\n--- 3. IT CANNOT SEE THE YEAR IT IS PRICING ---');
{
  let checked = 0, mismatched = 0, distinguishable = 0;
  for (const game of base) {
    for (const [key, s] of game) {
      if (s.shares.length === 0) continue;
      const [line, ys] = key.split('|');
      const y = Number(ys);
      const engine = new Map(s.shares.map(r => [r.memberId, r.experienceMod]));

      // recomputed from the ledger BEFORE the year — must match exactly
      const fromBefore = memberExperienceMods(s.members, line as CoverageLine, s.historyBefore, y);
      // and from the ledger AFTER — must NOT, or the test cannot tell
      const fromAfter = memberExperienceMods(s.members, line as CoverageLine, s.historyAfter, y);
      const afterBy = new Map(fromAfter.map(r => [r.memberId, r.mod]));

      let anyDiff = false;
      for (const r of fromBefore) {
        const e = engine.get(r.memberId);
        if (e === undefined) continue;
        checked++;
        if (e !== r.mod) mismatched++;
        if (afterBy.get(r.memberId) !== r.mod) anyDiff = true;
      }
      if (anyDiff) distinguishable++;
    }
  }
  console.log(`  ${checked} member-line-years recomputed from the PRIOR ledger`);
  console.log(`  mismatches against the engine's own mod: ${mismatched}  (must be 0)`);
  console.log(`  line-years where including the current year WOULD change it: ${distinguishable}  (must be > 0)   `
    + `${mismatched === 0 && distinguishable > 0 ? 'PASS' : 'FAIL'}`);
  if (mismatched > 0) {
    failures.push(`${mismatched} of ${checked} member-line-years have a mod that cannot be reproduced from the `
      + 'ledger as it stood BEFORE the year was processed. The modifier is reading the year it is pricing, which '
      + 'means a member is being charged for losses that had not happened when the price was set. Check that '
      + 'recordMemberLossYear still runs AFTER processLineYear in processYear.');
  }
  if (distinguishable === 0) {
    failures.push('including the current year in the window changed no mod anywhere, so the assertion above '
      + 'cannot distinguish a lookahead from correct behaviour and proves nothing.');
  }
}

// --------------------------------------------------------- 4 & 5. bounds
console.log('\n--- 4/5. BOUNDS, AND UNRATED MEMBERS SIT AT EXACTLY 1 ---');
{
  let outOfBand = 0, rows = 0, unrated = 0, unratedOff1 = 0;
  const seen: Record<string, { lo: number; hi: number }> = {};
  for (const game of base) {
    for (const [key, s] of game) {
      const line = key.split('|')[0] as CoverageLine;
      const y = Number(key.split('|')[1]);
      const mods = new Map(memberExperienceMods(s.members, line, s.historyBefore, y)
        .map(r => [r.memberId, r]));
      // The rebase divisor implied by this book, for the band.
      let wm = 0, we = 0;
      for (const r of s.shares) {
        const d = mods.get(r.memberId);
        if (!d?.rated) continue;
        wm += r.exposure * d.clampedRatio; we += r.exposure;
      }
      const M = we > 0 ? wm / we : 1;
      const { lo, hi } = modBounds(line, M);
      const t = (seen[line] ??= { lo: Infinity, hi: -Infinity });
      for (const r of s.shares) {
        rows++;
        const d = mods.get(r.memberId);
        if (d && !d.rated) {
          unrated++;
          if (r.experienceMod !== 1) unratedOff1++;
        }
        t.lo = Math.min(t.lo, r.experienceMod); t.hi = Math.max(t.hi, r.experienceMod);
        if (r.experienceMod < lo - 1e-9 || r.experienceMod > hi + 1e-9) outOfBand++;
      }
    }
  }
  for (const l of LINES) {
    const t = seen[l];
    if (t) console.log(`  ${l.padEnd(9)} observed mod range ${t.lo.toFixed(4)} .. ${t.hi.toFixed(4)}`);
  }
  console.log(`  ${rows} rows, ${outOfBand} outside the band their configuration allows  (must be 0)   `
    + `${outOfBand === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`  ${unrated} unrated rows, ${unratedOff1} of them not exactly 1  (must be 0)   `
    + `${unratedOff1 === 0 ? 'PASS' : 'FAIL'}`);
  if (outOfBand > 0) {
    failures.push(`${outOfBand} of ${rows} mods fall outside [1 + Z(floor/M - 1), 1 + Z(ceiling/M - 1)]. Either `
      + 'the clamp is not being applied or the mod is being built somewhere other than memberExperienceMods.');
  }
  if (unratedOff1 > 0) {
    failures.push(`${unratedOff1} members with too little history carry a mod other than exactly 1. An unrated `
      + 'member is one the design declines to have an opinion about, and a mod of 0.9997 is an opinion.');
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
  console.log('THE MODIFIER REDISTRIBUTES PREMIUM BETWEEN MEMBERS, IS CENTRED ON THE BOOK IT');
  console.log('RATES, CANNOT SEE THE YEAR IT IS PRICING, AND REACHES NEITHER THE POOL TOTAL,');
  console.log('THE RATE, NOR WHO IS IN THE BOOK.');
  console.log(RULE);
}
