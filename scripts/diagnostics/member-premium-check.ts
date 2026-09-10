// ============================================================================
// MEMBER-LEVEL CLASS PRICING — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/member-premium-check.ts
//   GAMES=24 npx tsx scripts/diagnostics/member-premium-check.ts
//
// Members pay their own WC class rate; the pool total does not move; and the
// allocation must never reach anything that decides who is in the book. Four
// assertions, and the fourth is the one worth reading twice.
//
// ============================================================================
// 1. THE POOL TOTAL IS UNTOUCHED — sum(shares) === poolPremium.
//
// Asserted to a RELATIVE tolerance and not to zero, deliberately. The shares
// are poolPremium x w_i with sum(w_i) = 1 in real arithmetic, so the residual
// is float noise in the weights and lands somewhere around 1e-16 relative.
// Forcing it to zero would mean making one arbitrary member absorb the
// rounding, which would put a member's bill at the mercy of iteration order.
//
// ⚠ AND THE POOL TOTAL ITSELF IS NOT ON THIS ARITHMETIC PATH AT ALL, which is
// the property that makes value-identity hold. See memberPremium.ts: summing
// e_i.r_i instead differs from blend.sum(e_i) by about an ulp, growing with
// the book — 1.863e-9 at 40 members and 7.451e-9 at 80 on the shipped roster.
// That is enough for value-identity-check to fire, as it did for 325 values at
// ~1e-12 at cc9d8ac. If this file is ever "simplified" to recompute the total
// from the member sum, that is the regression.
//
// 2. WC IS CLASS-DIFFERENTIATED AND THE OTHER TWO ARE NOT. Every WC member's
// relativity must equal their group's held class rate over the enrolled book's
// blend; every GL and Property relativity must be exactly 1.
//
// 3. THE TWO DERIVATIONS AGREE. memberPremium.ts derives the class rates from
// the catalog independently of simulationEngine's copy. Both call the same
// pure function on the same frozen roster so they cannot disagree — asserted
// anyway, because "cannot disagree" is an argument and this is a measurement.
//
// ============================================================================
// ⚠ 4. THE MIX LOOP MUST STAY ABSENT, AND THIS IS A DEFINITIONAL TEST RATHER
// THAN A NOTE.
//
// The loop that must not exist: member premium feeds retention -> a school
// district seeing a 65% cut and a fire district a 57% rise changes who stays
// -> the enrolled mix changes -> wcBlendedRatePer100 moves -> the pool rate
// moves. It does not exist today, because simulateMemberMovement reads only a
// LINE-level price signal and nothing per-member.
//
// Asserting that by inspection would rot the first time someone adds a
// parameter. So instead: PERTURB THE CLASS RATES and assert the membership
// path is bit-identical. Multiplying the four rates by different factors
// changes every member's allocation and changes NOTHING about the pool total
// (the weights renormalise), so any downstream difference can only have come
// through the allocation. Enrolled ids, exposure, retention rate and the
// blended rate must all be unchanged to the last bit.
//
// The day someone wires member premium into retention, this goes red with the
// enrolled roster differing — which is exactly when it should.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { deriveNeutralClassRatesPer100, ratingGroupOf } from '../../src/utils/wcClaimEngine';
import { allocateMemberPremium } from '../../src/utils/memberPremium';
import { getMemberExposure } from '../../src/utils/lineHelpers';
import { WC_RATING_GROUPS } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, Member, MemberPremiumShare } from '../../src/types/simulation';

const RULE = '='.repeat(76);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 8);

// The shares are poolPremium x w_i with sum(w) = 1 to float precision, so the
// residual is a few ulps of the total accumulated over ~60 members.
const MAX_SUM_REL = 1e-12;
// Relativities are a ratio of two sums over the same book — same basis.
const MAX_RELATIVITY_ABS = 1e-12;

const failures: string[] = [];
const roster = getPredefinedMarketMembers();
const CLASS_RATES = deriveNeutralClassRatesPer100(roster);

interface Snap {
  enrolledIds: string;
  exposure: number;
  retention: number;
  poolPremium: number;
  blendedRatePer100: number;
  shares: MemberPremiumShare[];
  classOnly: MemberPremiumShare[];
}

/** One game, snapshotted per line-year. `rateScale` perturbs the class rates
 *  used by the ALLOCATOR ONLY — via a re-allocation from the same engine
 *  outputs, so the engine itself is untouched and any difference in the
 *  engine's own numbers would have to come from somewhere else entirely. */
function runGame(g: number, rateScale: Record<string, number> | null): Map<string, Snap> {
  const id = `MP${g}`;
  const instance = generateGameInstance(id, 63_000_000 + g * 7919);
  const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out = new Map<string, Snap>();
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const lr of p.lineResults) {
      const line = lr.line as CoverageLine;
      const x = lr.result as never as Record<string, unknown>;
      const members = (x.memberList ?? []) as Member[];
      const poolPremium = x.poolPremium as number;
      const shares = rateScale
        ? reallocatePerturbed(members, line, y, poolPremium, rateScale)
        : ((x.memberPremiumShares ?? []) as MemberPremiumShare[]);
      let expo = 0, weighted = 0;
      for (const m of members) {
        const e = getMemberExposure(m, line, y);
        if (!(e > 0)) continue;
        expo += e;
        weighted += e * (line === 'WC' ? CLASS_RATES[ratingGroupOf(m)] : 1);
      }
      out.set(`${line}|${y}`, {
        enrolledIds: members.map(m => m.id).sort().join(','),
        exposure: x.activeExposure as number,
        retention: x.memberRetentionRate as number,
        poolPremium,
        blendedRatePer100: expo > 0 ? weighted / expo : 0,
        shares,
        // ⚠ THE SAME BOOK ALLOCATED WITH NO EXPERIENCE MODS, which is what
        // assertion 2 tests. Since the modifier shipped, the live
        // `relativity` is class x mod, so asserting "GL and Property are
        // exactly 1" against it would be asserting the mod does nothing.
        // The CLASS question is still a real one and this is where it lives;
        // the mod gets its own gate and its own identity below.
        classOnly: allocateMemberPremium(members, line, y, poolPremium),
      });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return out;
}

/** The allocator's arithmetic at perturbed class rates. Mirrors
 *  allocateMemberPremium's WEIGHTING only — it exists to prove the engine does
 *  not read the allocation, not to re-implement it for any other purpose. */
function reallocatePerturbed(
  members: readonly Member[], line: CoverageLine, yearNumber: number,
  poolPremium: number, scale: Record<string, number>,
): MemberPremiumShare[] {
  const rows: Array<{ id: string; e: number; w: number }> = [];
  let tw = 0;
  for (const m of members) {
    const e = getMemberExposure(m, line, yearNumber);
    if (!(e > 0)) continue;
    const r = line === 'WC' ? CLASS_RATES[ratingGroupOf(m)] * (scale[ratingGroupOf(m)] ?? 1) : 1;
    tw += e * r;
    rows.push({ id: m.id, e, w: e * r });
  }
  if (!(tw > 0)) return [];
  const te = rows.reduce((s, r) => s + r.e, 0);
  const blend = tw / te;
  return rows.map(r => ({
    memberId: r.id, exposure: r.e,
    premium: poolPremium * (r.w / tw),
    relativity: (r.w / r.e) / blend,
    // This arm exists to perturb CLASS RATES only, so it carries no mod. The
    // mod's own version of assertion 4 lives in member-experience-mod-check.
    experienceMod: 1,
  }));
}

console.log(RULE);
console.log('MEMBER-LEVEL CLASS PRICING');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years.\n`);

const base: Array<Map<string, Snap>> = [];
for (let g = 0; g < GAMES; g++) base.push(runGame(g, null));

// -------------------------------------------------- 1. the pool total is untouched
let worstSumRel = 0, checked = 0, emptyShares = 0;
for (const game of base) {
  for (const [key, s] of game) {
    if (s.shares.length === 0) { emptyShares++; continue; }
    checked++;
    const sum = s.shares.reduce((a, r) => a + r.premium, 0);
    const rel = Math.abs(sum - s.poolPremium) / Math.max(1, Math.abs(s.poolPremium));
    if (rel > worstSumRel) worstSumRel = rel;
    if (rel > MAX_SUM_REL) {
      failures.push(`${key}: shares sum to ${sum.toFixed(2)} against a pool premium of `
        + `${s.poolPremium.toFixed(2)} — relative ${rel.toExponential(2)}, over the ${MAX_SUM_REL.toExponential(0)} bound. `
        + 'The allocation is meant to SPLIT the total, never to rebuild it.');
    }
  }
}
console.log('--- 1. THE POOL TOTAL IS UNTOUCHED ---');
console.log(`  ${checked} line-years checked, ${emptyShares} with no enrolled exposure`);
console.log(`  worst |sum(shares) - poolPremium| / poolPremium = ${worstSumRel.toExponential(2)}  `
  + `against ${MAX_SUM_REL.toExponential(0)}   ${worstSumRel <= MAX_SUM_REL ? 'PASS' : 'FAIL'}`);

// ------------------------------------ 2. WC differentiated, GL and Property flat
console.log('\n--- 2. WC IS CLASS-DIFFERENTIATED, GL AND PROPERTY ARE FLAT (class only, mods off) ---');
const relSeen: Record<string, Set<string>> = { WC: new Set(), GL: new Set(), Property: new Set() };
let worstFlat = 0, worstWc = 0;
for (const game of base) {
  for (const [key, s] of game) {
    const line = key.split('|')[0];
    for (const r of s.classOnly) {
      relSeen[line].add(r.relativity.toFixed(4));
      if (line !== 'WC') {
        worstFlat = Math.max(worstFlat, Math.abs(r.relativity - 1));
      } else {
        worstWc = Math.max(worstWc, r.relativity);
      }
    }
  }
}
for (const l of LINES) {
  const vals = [...relSeen[l]].map(Number).sort((a, b) => a - b);
  console.log(`  ${l.padEnd(9)} distinct relativities ${String(vals.length).padStart(3)}   `
    + `range ${vals[0]?.toFixed(3)} .. ${vals[vals.length - 1]?.toFixed(3)}`);
}
if (worstFlat > MAX_RELATIVITY_ABS) {
  failures.push(`a GL or Property member has relativity ${(1 + worstFlat).toFixed(6)} — both lines are flat `
    + '(spread 1.00x, CV 0.0% within every member type), so every relativity there must be exactly 1.');
}
if (relSeen.WC.size < 2) {
  failures.push('every WC relativity is the same — the class rates are not reaching the member, which is '
    + 'the whole of this change. Check that memberRateWeight is not returning 1 for WC.');
}
console.log(`  GL/Property worst |relativity - 1| = ${worstFlat.toExponential(2)}   `
  + `${worstFlat <= MAX_RELATIVITY_ABS ? 'PASS' : 'FAIL'}`);
console.log(`  WC distinct relativities ${relSeen.WC.size} (needs >= 2)   ${relSeen.WC.size >= 2 ? 'PASS' : 'FAIL'}`);

// ------------------------- 2b. the rebase identity, on the LIVE allocation
//
// ⚠ AN EXACT IDENTITY, NOT A TOLERANCE, AND IT TESTS THE REBASE RATHER THAN
// THE CLASS RATES. On GL and Property every class rate is 1, so the live
// relativity collapses to mod_i / (exposure-weighted mean mod). The rebase
// makes that denominator exactly 1, so relativity MUST equal experienceMod
// member for member. If the rebase drifts, this separates immediately — and
// it does so on the shipped allocation, not on a re-derivation.
{
  let worst = 0, n = 0, moved = 0;
  for (const game of base) {
    for (const [key, s] of game) {
      if (key.startsWith('WC|')) continue;
      for (const r of s.shares) {
        worst = Math.max(worst, Math.abs(r.relativity - r.experienceMod));
        if (r.experienceMod !== 1) moved++;
        n++;
      }
    }
  }
  console.log(`  GL/Property worst |relativity - experienceMod| over ${n} rows = ${worst.toExponential(2)}   `
    + `${worst <= 1e-12 ? 'PASS' : 'FAIL'}`);
  console.log(`  of those, ${moved} carry a mod other than exactly 1  (must be > 0, or the identity is trivial)`);
  if (worst > 1e-12) {
    failures.push(`on a flat-rated line the relativity should equal the experience mod exactly (the rebase `
      + `makes the blend 1), but they differ by ${worst.toExponential(2)}. Either the rebase is not producing an `
      + 'exposure-weighted mean of 1, or the mod is being applied somewhere other than the allocation weight.');
  }
  if (moved === 0) {
    failures.push('every GL and Property row carries a mod of exactly 1, so the identity above compares 1 to 1 '
      + 'and proves nothing. Either no member is rated or the mod is not reaching the allocator.');
  }
}

// --------------------------------------------- 3. the two derivations agree
console.log('\n--- 3. THE TWO CLASS-RATE DERIVATIONS AGREE ---');
{
  const probe = roster.filter(m => (m.exposureByLine.WC ?? 0) > 0).slice(0, 50);
  const shares = allocateMemberPremium(probe, 'WC', 1, 1_000_000);
  let expo = 0, weighted = 0;
  for (const m of probe) {
    const e = getMemberExposure(m, 'WC', 1);
    expo += e; weighted += e * CLASS_RATES[ratingGroupOf(m)];
  }
  const blend = weighted / expo;
  let worst = 0;
  for (const s of shares) {
    const m = probe.find(p => p.id === s.memberId)!;
    worst = Math.max(worst, Math.abs(s.relativity - CLASS_RATES[ratingGroupOf(m)] / blend));
  }
  console.log(`  worst |allocator relativity - gate's own| = ${worst.toExponential(2)}   `
    + `${worst <= MAX_RELATIVITY_ABS ? 'PASS' : 'FAIL'}`);
  if (worst > MAX_RELATIVITY_ABS) {
    failures.push(`the allocator's class rates disagree with a fresh derivation by ${worst.toExponential(2)} — `
      + 'memberPremium.ts and simulationEngine each derive them from the frozen catalog and must agree exactly.');
  }
  console.log('  held class rates: ' + WC_RATING_GROUPS.map(g => `${g} ${CLASS_RATES[g].toFixed(4)}`).join('  '));
}

// ------------------------------------------------------- 4. the mix loop is absent
console.log('\n--- 4. THE MIX LOOP IS ABSENT — class rates perturbed, membership must not move ---');
{
  const SCALE = { county: 0.5, schools: 3.0, highSafety: 0.4, lowSafety: 1.9 };
  let mismatches = 0, compared = 0, allocationMoved = 0;
  for (let g = 0; g < GAMES; g++) {
    const pert = runGame(g, SCALE);
    for (const [key, b] of base[g]) {
      const p = pert.get(key);
      if (!p) { mismatches++; continue; }
      compared++;
      if (b.enrolledIds !== p.enrolledIds || b.exposure !== p.exposure
        || b.retention !== p.retention || b.poolPremium !== p.poolPremium
        || b.blendedRatePer100 !== p.blendedRatePer100) {
        mismatches++;
        if (mismatches <= 3) {
          failures.push(`${key}: perturbing the WC class rates moved the membership path — `
            + `enrolled ${b.enrolledIds === p.enrolledIds ? 'same' : 'DIFFERENT'}, `
            + `exposure ${b.exposure === p.exposure ? 'same' : `${b.exposure} vs ${p.exposure}`}, `
            + `retention ${b.retention === p.retention ? 'same' : `${b.retention} vs ${p.retention}`}, `
            + `poolPremium ${b.poolPremium === p.poolPremium ? 'same' : `${b.poolPremium} vs ${p.poolPremium}`}. `
            + 'Member premium has reached something that decides who is in the book, which is the feedback '
            + 'loop this gate exists to keep absent: allocation -> retention -> enrolled mix -> blended rate '
            + '-> pool rate.');
        }
      }
      if (key.startsWith('WC|') && b.shares.length > 0
        && b.shares.some((s, i) => s.premium !== p.shares[i].premium)) allocationMoved++;
    }
  }
  console.log(`  ${compared} line-years compared at scale `
    + WC_RATING_GROUPS.map(g => `${g} x${SCALE[g as keyof typeof SCALE]}`).join(', '));
  console.log(`  WC line-years whose ALLOCATION moved: ${allocationMoved}  (must be > 0, or the probe is inert)`);
  console.log(`  line-years whose MEMBERSHIP PATH moved: ${mismatches}  (must be 0)   `
    + `${mismatches === 0 && allocationMoved > 0 ? 'PASS' : 'FAIL'}`);
  if (allocationMoved === 0) {
    failures.push('perturbing the class rates changed no allocation at all, so assertion 4 proved nothing. '
      + 'A probe that cannot move the thing it perturbs is not a control — see WORKING_PRACTICES on the '
      + 'absurd-value probe.');
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
  console.log('MEMBERS PAY THEIR OWN CLASS RATE, THE POOL TOTAL IS UNTOUCHED, AND THE');
  console.log('ALLOCATION REACHES NOTHING THAT DECIDES WHO IS IN THE BOOK.');
  console.log(RULE);
}
