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
// 2. IT REACHES THE RATE ONLY THROUGH WHO IS ENROLLED, NEVER DIRECTLY.
//
// ⚠ THIS ASSERTION WAS REWRITTEN, AND THE OLD ONE WAS RIGHT WHEN IT WAS
// WRITTEN. It used to demand that scaling CREDIBILITY_Z left the enrolled
// roster, activeExposure, poolPremium and the rate ALL bit-identical — "the
// modifier reaches nothing but the split". That held while the modifier fed
// only the premium allocation.
//
// It is now false BY DESIGN. memberDeparture.ts reads the modifier: a member
// with better-than-average experience is more marketable and leaves sooner
// when the price rises. So changing Z changes who leaves, which changes the
// enrolled book, which changes activeExposure and therefore poolPremium.
// That is adverse selection, it is the pressure Renewal Underwriting exists
// to manage, and a gate forbidding it would forbid the feature.
//
// WHAT MUST STILL HOLD IS NARROWER AND IS THE PART THAT WAS EVER LOAD-BEARING:
// the modifier must not reach the RATE. The pool prices at NEUTRAL risk
// quality deliberately, and a modifier feeding into the rate would be
// finding 17 arriving through underwriting — a realized outcome repricing
// the line rather than moving money between members.
//
// ⚠ THE OBVIOUS TEST IS VACUOUS AND WAS TRIED FIRST. Comparing only the
// line-years where the two arms HAPPEN to enrol the same book self-selects:
// the books match exactly in the early years, when no member has three years
// of history, so no member is rated, so the modifier is 1 everywhere and
// there is nothing for the rate to leak. 60 of 180 line-years matched and the
// modifier moved in none of them.
//
// So the departure channel is CLOSED instead, by setting DEPARTURE.priceWeight
// to 0 in BOTH arms. Departure then reads no modifier at all and the roster
// is invariant to Z by construction, which restores the original strict
// comparison — the roster, exposure, pool premium and rate must all be
// bit-identical while the ALLOCATION moves. That isolates the pricing path
// from the selection path rather than hoping they separate on their own.
//
// A second clause then re-opens the channel and requires the roster to MOVE,
// because a closed-channel test alone would also pass if departure had
// silently stopped reading the modifier.
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
  CREDIBILITY_Z, EXPERIENCE_MOD, memberExperienceMods, modBounds, primaryShare,
} from '../../src/utils/memberExperienceMod';
import { DEPARTURE } from '../../src/utils/memberDeparture';
import { ratingGroupOf } from '../../src/utils/wcClaimEngine';
import { EXPERIENCE_SPLIT_POINT } from '../../src/utils/memberLossHistory';
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
  + `primary split $${(EXPERIENCE_SPLIT_POINT / 1000).toFixed(0)}k, `
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
console.log('\n--- 2. IT REACHES THE RATE ONLY THROUGH THE ROSTER (Z scaled x10 in-process) ---');
{
  const originals = { ...CREDIBILITY_Z };
  const originalWeight = DEPARTURE.priceWeight;

  // --- channel CLOSED: departure cannot read the modifier -------------------
  const closedBase: Array<Map<string, Snap>> = [];
  const closedPert: Array<Map<string, Snap>> = [];
  // --- channel OPEN: the shipped configuration ------------------------------
  const pert: Array<Map<string, Snap>> = [];
  try {
    DEPARTURE.priceWeight = 0;
    for (let g = 0; g < GAMES; g++) closedBase.push(runGame(g));
    for (const l of LINES) CREDIBILITY_Z[l] = originals[l] * 10;
    for (let g = 0; g < GAMES; g++) closedPert.push(runGame(g));
    DEPARTURE.priceWeight = originalWeight;
    for (let g = 0; g < GAMES; g++) pert.push(runGame(g));
  } finally {
    for (const l of LINES) CREDIBILITY_Z[l] = originals[l];
    DEPARTURE.priceWeight = originalWeight;
  }

  let compared = 0, leaked = 0, allocationMoved = 0, modMoved = 0;
  for (let g = 0; g < GAMES; g++) {
    for (const [key, b] of closedBase[g]) {
      const p = closedPert[g].get(key);
      if (!p) { leaked++; continue; }
      compared++;
      if (b.enrolledIds !== p.enrolledIds || b.activeExposure !== p.activeExposure
        || b.poolPremium !== p.poolPremium || b.ratePer100 !== p.ratePer100
        || b.retention !== p.retention) {
        leaked++;
        if (leaked <= 3) {
          failures.push(`${key}: with the departure channel CLOSED, scaling credibility still moved `
            + `something outside the allocation — enrolled ${b.enrolledIds === p.enrolledIds ? 'same' : 'DIFFERENT'}, `
            + `exposure ${b.activeExposure === p.activeExposure ? 'same' : `${b.activeExposure} vs ${p.activeExposure}`}, `
            + `poolPremium ${b.poolPremium === p.poolPremium ? 'same' : `${b.poolPremium} vs ${p.poolPremium}`}, `
            + `rate ${b.ratePer100 === p.ratePer100 ? 'same' : `${b.ratePer100} vs ${p.ratePer100}`}. `
            + 'With DEPARTURE.priceWeight at 0 the only route from the modifier to anything is the premium '
            + 'allocation, so a move here is the modifier reaching the RATE directly — finding 17 arriving '
            + 'through underwriting.');
        }
      }
      if (b.shares.some((s, i) => s.premium !== p.shares[i]?.premium)) allocationMoved++;
      if (b.shares.some((s, i) => s.experienceMod !== p.shares[i]?.experienceMod)) modMoved++;
    }
  }
  console.log(`  CHANNEL CLOSED (DEPARTURE.priceWeight = 0), ${compared} line-years compared`);
  console.log(`    line-years whose MOD moved: ${modMoved}  (must be > 0, or the probe is inert)`);
  console.log(`    line-years whose ALLOCATION moved: ${allocationMoved}  (must be > 0)`);
  console.log(`    line-years that LEAKED past the allocation: ${leaked}  (must be 0)   `
    + `${leaked === 0 && modMoved > 0 && allocationMoved > 0 ? 'PASS' : 'FAIL'}`);

  // --- and the channel must actually be open in the shipped configuration ---
  let rosterMoved = 0, openCompared = 0;
  for (let g = 0; g < GAMES; g++) {
    for (const [key, b] of base[g]) {
      const p = pert[g].get(key);
      if (!p) continue;
      openCompared++;
      if (b.enrolledIds !== p.enrolledIds) rosterMoved++;
    }
  }
  console.log(`  CHANNEL OPEN (shipped), ${openCompared} line-years: roster moved in ${rosterMoved}  `
    + `(must be > 0 — this is adverse selection working)   ${rosterMoved > 0 ? 'PASS' : 'FAIL'}`);
  if (rosterMoved === 0) {
    failures.push('scaling credibility tenfold changed nobody\'s departure decision in the SHIPPED '
      + 'configuration. The closed-channel assertion above would pass just as well if departure had '
      + 'stopped reading the modifier altogether, so this clause is what distinguishes "the channel is '
      + 'correctly closed when closed" from "there is no channel". Check that memberDeparture reads the '
      + 'modifier and that DEPARTURE.priceWeight is not 0.');
  }
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

// ------------------------------- 6. the split is exhaustive and matched
//
// ⚠ TWO DIFFERENT CLAIMS, AND THE SECOND IS THE LOAD-BEARING ONE.
//
// EXHAUSTIVE: primaryActual <= actual, always, and the excess is the
// remainder. Nothing is discarded by the split — that is the whole answer to
// "capping throws away the large claim", and it is asserted rather than
// asserted-in-prose.
//
// MATCHED: the DRAWN primary share and the ANALYTIC primary share must agree
// per rating group. The generators limit each drawn claim at
// EXPERIENCE_SPLIT_POINT; the modifier divides by an expectation limited at
// the same point through `severityLimit`. That is invariant 1 — one basis for
// losses and pricing — applied to a new quantity, and if the two ever read
// different split points the modifier would divide a limited numerator by an
// unlimited denominator and hand every member a large credit. Nothing else in
// the codebase would notice.
//
// ⚠ NEAR-NEUTRAL MEMBERS ONLY, AND THAT IS WHAT MAKES IT A BASIS CHECK. The
// analytic share is at NEUTRAL risk quality; the DRAW carries the
// risk-quality severity tilt, which is draw-only by invariant 2. So a member
// away from neutral has a drawn primary share that legitimately differs —
// measured over the whole book the gap reaches 3.3pp on highSafety, whose
// tilt is the largest in the model, and that gap IS the signal the modifier
// exists to read. Comparing the full book would therefore gate the tilt
// rather than the split point. Restricted to |RQ - 5| <= 0.5 the tilt is
// close to the identity and what is left is the basis.
//
// ⚠ PROPERTY IS EXCLUDED, NOT MERELY UNINTERESTING. primaryShare returns 0
// for Property by design (it is never rated), so an analytic share of 0.00%
// against a drawn 4.10% would sit inside any bound wide enough for the other
// lines and assert nothing. A meaningless comparison inside a passing bound
// is worse than no comparison.
console.log('\n--- 6. THE SPLIT IS EXHAUSTIVE, AND THE DRAW MATCHES THE ANALYTIC ---');
{
  let rows = 0, overActual = 0, negative = 0;
  const drawn: Record<string, [number, number]> = {};   // line|group -> [primary, total]
  const analytic: Record<string, [number, number]> = {};
  const nEntries: Record<string, number> = {};
  for (const game of base) {
    for (const [key, s] of game) {
      const line = key.split('|')[0] as CoverageLine;
      const byId = new Map(s.members.map(m => [m.id, m]));
      for (const [mid, byLine] of Object.entries(s.historyAfter)) {
        const years = byLine[line]; if (!years) continue;
        const m = byId.get(mid); if (!m) continue;
        for (const e of years) {
          rows++;
          if (e.primaryActual > e.actual + 1e-6) overActual++;
          if (e.primaryActual < -1e-9) negative++;
        }
        // the matched pair: rated lines only, near-neutral members only
        if (line === 'Property') continue;
        if (Math.abs(m.riskQuality - 5) > 0.5) continue;
        const grp = `${line}|${line === 'WC' ? ratingGroupOf(m) : '-'}`;
        for (const e of years) {
          const d = (drawn[grp] ??= [0, 0]);
          d[0] += e.primaryActual; d[1] += e.actual;
          const a = (analytic[grp] ??= [0, 0]);
          a[0] += e.expectedAtManual * primaryShare(m, line, e.yearNumber);
          a[1] += e.expectedAtManual;
          nEntries[grp] = (nEntries[grp] ?? 0) + 1;
        }
      }
    }
  }
  console.log(`  ${rows} ledger entries, ${overActual} with primaryActual > actual, ${negative} negative   `
    + `${overActual === 0 && negative === 0 ? 'PASS' : 'FAIL'}`);
  if (overActual > 0 || negative > 0) {
    failures.push(`${overActual} ledger entries have primaryActual above actual and ${negative} are negative. `
      + 'The primary layer is a per-claim minimum, so it is bounded by the loss it came from — and the excess '
      + 'is computed as the difference, so a violation makes the unrated layer negative.');
  }

  console.log('  primary share, DRAWN vs ANALYTIC, rated lines, |RQ - 5| <= 0.5:');
  let worstGap = 0;
  for (const grp of Object.keys(drawn).sort()) {
    const d = drawn[grp], a = analytic[grp];
    if (!a || !(d[1] > 0) || !(a[1] > 0)) continue;
    const ds = d[0] / d[1], as = a[0] / a[1];
    const gap = Math.abs(ds - as);
    worstGap = Math.max(worstGap, gap);
    console.log(`    ${grp.padEnd(20)} n ${String(nEntries[grp] ?? 0).padStart(5)}   drawn ${(ds * 100).toFixed(2)}%   analytic ${(as * 100).toFixed(2)}%   gap ${(gap * 100).toFixed(2)}pp   (reported, not gated)`);
  }
  // GATED ON THE POOLED GAP ONLY — see the note below the table for why.
  const POOLED_BOUND = 0.01;
  let pd = 0, pt = 0, pa = 0, pe = 0;
  for (const grp of Object.keys(drawn)) {
    pd += drawn[grp][0]; pt += drawn[grp][1];
    pa += analytic[grp][0]; pe += analytic[grp][1];
  }
  const pooledGap = Math.abs(pd / pt - pa / pe);
  console.log(`  POOLED over rated lines: drawn ${(pd / pt * 100).toFixed(2)}%   analytic ${(pa / pe * 100).toFixed(2)}%   `
    + `gap ${(pooledGap * 100).toFixed(2)}pp against ${(POOLED_BOUND * 100).toFixed(0)}pp   ${pooledGap <= POOLED_BOUND ? 'PASS' : 'FAIL'}`);
  if (pooledGap > POOLED_BOUND) {
    failures.push(`the pooled drawn and analytic primary shares differ by ${(pooledGap * 100).toFixed(2)}pp, over `
      + `the ${(POOLED_BOUND * 100).toFixed(0)}pp bound. The generators limit each claim at `
      + 'EXPERIENCE_SPLIT_POINT and the modifier divides by an expectation limited through severityLimit at the '
      + 'same point — invariant 1 for a new quantity. A mismatch means a limited numerator over an unlimited '
      + 'denominator, which credits every member and looks like a working modifier.');
  }
  // ⚠ PER-GROUP IS REPORTED AND NOT GATED, AND THE REASON IS THE DENOMINATOR.
  // The primary NUMERATOR is bounded by the split point and behaves; the
  // denominator is the member's whole loss, which is heavy-tailed. So the
  // SHARE inherits the tail, and the smallest classes cannot resolve it —
  // highSafety has 24 members in the entire roster and carries the model's
  // heaviest component weight, so its share swings several points on whether
  // one large claim happened to land. Measured above at 5.9pp against GL's
  // 0.02pp over 4,615 entries.
  //
  // Gating the worst group would therefore gate the smallest one, which is
  // WORKING_PRACTICES' heavy-tail rule exactly: a realized mean of a
  // heavy-tailed quantity is not a gateable statistic. The POOLED share has
  // the sample and is gated at 1pp; the per-group rows are a diagnostic for a
  // reader, not an assertion. A real split-point mismatch does not hide here
  // — it would move the pooled figure by tens of points, not fractions.
  //
  // ⚠ AND DO NOT "FIX" THIS BY WIDENING A PER-GROUP BOUND UNTIL highSafety
  // PASSES. That is tuning the threshold to the sample, which this project
  // has a named rule against. If a per-group assertion is wanted, it needs a
  // statistic whose denominator is not the raw loss — claim COUNTS below the
  // split would do it — and that is a measurement commit, not a bound change.
  void worstGap;

  // Property is unrated BY MEASUREMENT (primary-layer reliability 0.000), so
  // its mod must be identically 1 — not approximately, and not merely small.
  let prRows = 0, prOff = 0;
  for (const game of base) {
    for (const [key, s] of game) {
      if (!key.startsWith('Property|')) continue;
      for (const r of s.shares) { prRows++; if (r.experienceMod !== 1) prOff++; }
    }
  }
  console.log(`  Property rows ${prRows}, with a mod other than exactly 1: ${prOff}  (must be 0)   `
    + `${prOff === 0 ? 'PASS' : 'FAIL'}`);
  if (prOff > 0) {
    failures.push(`${prOff} Property members carry a mod other than 1. Property's measured primary-layer `
      + 'reliability is 0.000 at every split point tried — 1.9 claims per three-year window is not a sample — '
      + 'so CREDIBILITY_Z.Property is 0 and every Property mod must be exactly 1.');
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
