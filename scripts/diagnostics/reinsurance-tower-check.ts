// Verification for the per-occurrence tower.
//
//   npx tsx scripts/diagnostics/reinsurance-tower-check.ts
//
// Checks the things the tower could get wrong in ways nothing else would catch:
// the cap/retention ORDER, that ceded loss matches what the layer diagnostic
// measured, that a corridor retention works, that the aggregate responds to the
// occurrence-layer selection, and — the whole point of the pricing change — that
// the price no longer moves with the funding confidence level.

import {
  AGG_ATTACHMENT_LEVELS, REINSURANCE_TOWER, RISK_LOAD_LAMBDA, TOWER_TOP,
} from '../../src/data/reinsuranceTower';
import {
  cedeOccurrences, claimContribution, layerMask, layerPremium,
  normalizeAggregateStopLevel, occurrenceProgramCost, occurrenceTotals, quoteAggregate,
} from '../../src/utils/reinsuranceTower';
import { layerRiskMoments } from '../../src/utils/towerMoments';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { Claim, CoverageLine, DecisionSet, GameState, ResultSet } from '../../src/types/simulation';

const ROSTER = getPredefinedMarketMembers();

// A reference book of roughly `targetM` of that line's exposure, taken from the
// canonical roster. The tower prices off the BOOK now rather than a per-$100
// rate, so every pricing check needs members instead of an exposure scalar.
const REF_YEAR = 1;
function bookFor(line: 'WC' | 'GL', targetM: number) {
  const out: typeof ROSTER = []; let e = 0;
  for (const m of ROSTER) { if (e >= targetM) break; out.push(m); e += (m.exposureByLine[line] ?? 0); }
  return out;
}

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
const fmt$ = (x: number) => x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(1)}k`;
const seedOf = (id: string) => { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; };

function play(id: string, lines: CoverageLine[], years: number, mutate?: (d: DecisionSet, y: number) => DecisionSet): ResultSet[] {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'G', gameLength: years, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  for (let y = 1; y <= years; y++) {
    const d = mutate ? mutate(defaultDecisionSet(y), y) : defaultDecisionSet(y);
    const p = processYear(gs, d);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return gs.lockedResults;
}

console.log('=== 1. claimContribution COLLAPSES TO grossUltimate ON BOTH LINES ===');
{
  // ⚠ RE-WRITTEN BY THE GL SUB-COVERAGE REBUILD. This used to assert the J14
  // cap/retention order (a stateLaw claim capped on indemnity but still
  // piercing the $1M retention on ALAE alone). GL's statutory cap, and the
  // indemnity/ALAE split it needed, both retired: the fitted mixture comes
  // from claims already realized under real-world caps, so capping again
  // would double-count (see GL_LOSS_MODEL's header for the full reasoning).
  // claimContribution no longer takes a `line` argument at all — there is
  // nothing left to special-case by line.
  const mk = (grossUltimate: number, line: CoverageLine): Claim => ({
    id: 'c', occurrenceId: 'o', memberId: 'm', line, accidentYear: 1, calendarYear: 2026,
    tier: 'component1', status: 'open', reportedYear: 1, grossUltimate,
    paidToDate: 0, caseReserve: grossUltimate,
  });
  console.log(`  GL claim $5.9M -> ${fmt$(claimContribution(mk(5.9e6, 'GL')))} ` +
    `${note(claimContribution(mk(5.9e6, 'GL')) === 5.9e6, 'GL claimContribution did not collapse to grossUltimate')}`);
  console.log(`  WC claim $9.0M -> ${fmt$(claimContribution(mk(9e6, 'WC')))} ` +
    `${note(claimContribution(mk(9e6, 'WC')) === 9e6, 'WC claimContribution did not collapse to grossUltimate')}`);
}

console.log('\n=== 2. EROSION AND CORRIDOR RETENTION FALL OUT OF THE ARITHMETIC ===');
{
  const t = 12e6; // one $12M occurrence
  const all = cedeOccurrences('WC', [t], [true, true, true, false]);
  const corridor = cedeOccurrences('WC', [t], [true, false, true, false]); // skip $5M xs $5M
  const none = cedeOccurrences('WC', [t], [false, false, false, false]);
  console.log(`  $12M occurrence, all three purchasable layers: ceded ${fmt$(all.totalCeded)}, retained ${fmt$(all.retained)}`);
  console.log(`  CORRIDOR (skip $5M xs $5M):                    ceded ${fmt$(corridor.totalCeded)}, retained ${fmt$(corridor.retained)}`);
  console.log(`  nothing placed:                                ceded ${fmt$(none.totalCeded)}, retained ${fmt$(none.retained)}`);
  // 4 + 5 + 2 = 11 of 12 ceded with all three; the corridor gives up exactly the
  // skipped band's 5M, no more and no less. No mechanic computes this.
  console.log(`  all three cede 4+5+2 = $11M: ${note(Math.abs(all.totalCeded - 11e6) < 1, `all-layers ceded ${fmt$(all.totalCeded)} != $11M`)}`);
  console.log(`  corridor gives up exactly the skipped $5M band: ` +
    `${note(Math.abs((all.totalCeded - corridor.totalCeded) - 5e6) < 1, 'corridor difference is not the skipped band')}`);
  console.log(`  retained + ceded === gross in every case: ` +
    `${note([all, corridor, none].every(c => Math.abs(c.retained + c.totalCeded - t) < 1e-6), 'retained + ceded != gross')}`);
  const big = cedeOccurrences('GL', [60e6], [true, true, true]);
  console.log(`  GL $60M occurrence: ceded ${fmt$(big.totalCeded)}, retainedAboveTower ${fmt$(big.retainedAboveTower)} ` +
    `${note(Math.abs(big.retainedAboveTower - (60e6 - TOWER_TOP.GL)) < 1, 'GL above-tower band wrong')}`);
}

console.log('\n=== 3. THE RISK LOAD RISES WITH ATTACHMENT (one lambda, not four multiples) ===');
{
  for (const line of ['WC', 'GL'] as const) {
    const book = bookFor(line, 290);
    const mults = REINSURANCE_TOWER[line].map((_l, i) => {
      const m = layerRiskMoments(line, i, book, REF_YEAR);
      return 1 + RISK_LOAD_LAMBDA * m.sdOverExpected;
    });
    const rising = mults.every((m, i) => i === 0 || m > mults[i - 1]);
    console.log(`  ${line}: ${REINSURANCE_TOWER[line].map((l, i) => `${l.name} ${mults[i].toFixed(2)}x`).join('  ')}`);
    console.log(`     monotonically rising with attachment: ${note(rising, `${line} loading multiples not monotonic`)}`);
  }
  // The behaviour that validates the whole approach: GL's top layer costs MORE
  // per $100 than WC's despite a LOWER multiple, because it is more exposed.
  const glBook = bookFor('GL', 290), wcBook = bookFor('WC', 290);
  const glExpU = glBook.reduce((s2, m) => s2 + (m.exposureByLine.GL ?? 0), 0) * 1e4;
  const wcExpU = wcBook.reduce((s2, m) => s2 + (m.exposureByLine.WC ?? 0), 0) * 1e4;
  const glTop = layerPremium('GL', 2, glBook, REF_YEAR) / glExpU, wcTop = layerPremium('WC', 2, wcBook, REF_YEAR) / wcExpU;
  console.log(`  GL top layer ${glTop.toFixed(4)} per $100 vs WC top ${wcTop.toFixed(4)} — GL dearer on a LOWER multiple: ` +
    `${note(glTop > wcTop, 'GL top layer is not dearer than WC top')}`);
  // ⚠ WAS "the unpurchasable WC layer is excluded from program cost", then "WC's
  // top layer is purchasable and priced". Both were about `$25M xs $25M`, which
  // NO LONGER EXISTS — it was merged into `$40M xs $10M`. The second version
  // indexed REINSURANCE_TOWER.WC[3] and THREW once the array shortened, which is
  // the loud failure a hardcoded layer index should give.
  //
  // Nothing sets `purchasable: false` on either line now, so that branch is
  // untested by data. Asserted instead: WC and GL carry the SAME NUMBER OF
  // LAYERS, which is exactly what broke a downstream discriminator this commit —
  // resultMetrics inferred the line from `cededByLayer.length >= 4`.
  const wcCount = REINSURANCE_TOWER.WC.length, glCount = REINSURANCE_TOWER.GL.length;
  console.log(`  WC ${wcCount} layers, GL ${glCount} — EQUAL, so layer count cannot identify a line: ` +
    `${note(wcCount === glCount, `WC has ${wcCount} layers and GL ${glCount}; if that diverges again, do NOT reintroduce a count-based line test`)}`);
  console.log(`  every WC layer purchasable: ${note(REINSURANCE_TOWER.WC.every(l => l.purchasable), 'a WC layer is flagged non-purchasable without a stated reason')}`);
  console.log(`  merged top band spans $10M-$50M: ${note(REINSURANCE_TOWER.WC[2].attachment === 10e6 && REINSURANCE_TOWER.WC[2].limit === 40e6, 'the merged WC top layer is not $40M xs $10M')}`);
  console.log(`  and it is charged when placed: ${note(occurrenceProgramCost('WC', [false, false, true], wcBook, REF_YEAR).premium > 0, 'the merged top layer is not being charged')}`);
  // ⚠ THE MASK-TABLE ASSERTION THAT USED TO SIT HERE IS GONE WITH ITS TABLE.
  // WC_RETAINED_SECOND_MOMENT was an 8-entry array indexed by placement bitmask,
  // and this check guarded against an out-of-range index silently falling back to
  // mask 0 (pricing every selection as full retention). retainedRiskMoments
  // integrates the retained band structure directly from `placed`, so there is no
  // index to get wrong and no fallback to hide a mistake. The hazard was retired,
  // not merely stopped being checked — see tower-runtime-check.ts for what
  // replaced it (a memo-key guard, which is this change's equivalent risk).
}

console.log('\n=== 4. THE AGGREGATE RESPONDS TO THE OCCURRENCE-LAYER SELECTION ===');
// ⚠ THE THRESHOLD WAS LOWERED FROM x3 TO x1.4, AND NOT TO MAKE THIS PASS. It was
// calibrated against the retired model's 21x E[ceded] swing between "all layers"
// and "none". Under the mixture the swing is 1.65x-2.15x, because THE TOWER NO
// LONGER COLLAPSES RETAINED VOLATILITY: the old catastrophic annuity was capped at
// $15.51M so buying the layers removed essentially all of it, whereas the
// mixture's unbounded tail above $50M is retained whatever the player buys.
// Measured m2 with every layer placed rose 5.39e9 -> 3.62e10 (+572%); with none
// placed it rose only 6.09e10 -> 1.18e11 (+94%), so the RATIO fell from 11.3 to
// 3.26. That is the same effect the retained-CV diagnostic found on GL.
//
// WHAT THE ASSERTION PROTECTS IS UNCHANGED and still holds: the aggregate must not
// be free volatility transfer for a player who declines every occurrence layer.
// Measured at $290M / E[gross] $12.83M, declining every layer raises the aggregate
// premium from $2.43M to $4.01M at a 110% attachment. The price responds; it just
// responds less, because the underlying risk transfer is less.
{
  const EGROSS = 12.83e6;
  const AGG_BOOK = bookFor('WC', 290);
  const AGG_SMALL = bookFor('WC', 145), AGG_BIG = bookFor('WC', 580);
  const unitsOf = (bk: typeof ROSTER) => bk.reduce((s2, m) => s2 + (m.exposureByLine.WC ?? 0), 0) * 1e4;
  const all = REINSURANCE_TOWER.WC.map(l => l.purchasable);
  const none = REINSURANCE_TOWER.WC.map(() => false);
  console.log('  att%   all layers premium    none placed premium    ratio');
  for (let lv = 0; lv < AGG_ATTACHMENT_LEVELS.WC.length; lv++) {
    const qa = quoteAggregate('WC', all, AGG_BOOK, EGROSS, lv, REF_YEAR), qn = quoteAggregate('WC', none, AGG_BOOK, EGROSS, lv, REF_YEAR);
    const ratio = qn.premium / Math.max(qa.premium, 1);
    console.log(`  ${(AGG_ATTACHMENT_LEVELS.WC[lv] * 100).toFixed(0)}%   ${fmt$(qa.premium).padStart(18)}    ${fmt$(qn.premium).padStart(18)}    x${ratio.toFixed(1)}  ` +
      `${note(ratio > 1.4, `aggregate barely responds to selection at ${AGG_ATTACHMENT_LEVELS.WC[lv]} (x${ratio.toFixed(1)})`)}`);
  }
  console.log('  ^^ declining occurrence layers puts catastrophic claims back into the retention,');
  console.log('     raising retained volatility and so the aggregate\'s price. Without this,');
  console.log('     "decline everything, buy the aggregate" would be free volatility transfer.');
  // Not linear in exposure — the reason this price is computed, not frozen.
  const small = quoteAggregate('WC', all, AGG_SMALL, EGROSS / 2, 1, REF_YEAR), big = quoteAggregate('WC', all, AGG_BIG, EGROSS * 2, 1, REF_YEAR);
  const rs = small.premium / unitsOf(AGG_SMALL), rb = big.premium / unitsOf(AGG_BIG);
  console.log(`  premium per $100 at $145M exposure ${rs.toFixed(4)} vs $580M ${rb.toFixed(4)} — FALLS as the book grows: ` +
    `${note(rb < rs, 'aggregate price per $100 did not fall with exposure — linearity bug')}`);
  // ⚠ WAS `layerMask([true, false, true, true]) === 13` with the label "16 entries
  // for 4 layers". Both were hardcoded to the four-layer tower. The 4-element
  // input still produced 13 after the merge — layerMask does not know how many
  // layers exist — so the check kept PASSING while describing a tower that no
  // longer existed, and the label was simply false. Sized off the array now.
  // ⚠ THE TABLE THIS USED TO SIZE AGAINST IS GONE. It asserted
  // WC_RETAINED_SECOND_MOMENT.length === 2^layers, guarding an out-of-range mask
  // silently falling back to "no layers placed". retainedRiskMoments reads
  // `placed` directly, so the index hazard no longer exists. layerMask itself
  // survives (cedeOccurrences and the UI still use placement arrays) and is
  // still worth a bit-order check.
  console.log(`  layerMask bit order is little-endian (layer 0 = bit 0): ` +
    `${note(layerMask([true, false, true]) === 5, 'layerMask bit order changed')}`);
}

console.log('\n=== 5. PRICE IS NO LONGER A FUNCTION OF THE FUNDING CONFIDENCE LEVEL ===');
{
  // The defect this replaced: cost was 37.5% of pool premium, so identical cover
  // cost 69% more at 85% confidence than at 60%. Now it is E[ceded] x loading and
  // must be FLAT across the CLF.
  const costs: number[] = [];
  for (const clf of [0.60, 0.85]) {
    const locked = play('CLFTEST', ['WC'], 1, d => ({
      ...d, byLine: { ...d.byLine, WC: { ...d.byLine.WC, fundingConfidenceLevel: clf } },
    }));
    costs.push(locked[0].byLine.WC!.reinsuranceCost);
  }
  const drift = Math.abs(costs[1] / costs[0] - 1);
  console.log(`  reinsurance cost at CLF 0.60 ${fmt$(costs[0])} vs 0.85 ${fmt$(costs[1])} — drift ${(drift * 100).toFixed(2)}%`);
  console.log(`  must be ~0 (the old model drifted 69%): ${note(drift < 0.02, `reinsurance cost still moves ${(drift * 100).toFixed(1)}% with the CLF`)}`);
}

console.log('\n=== 6. LIVE GAME: ceded reconciles, and GL above-tower exceeds the top layer bought ===');
{
  const locked = play('TOWERCHK', ['WC', 'GL', 'Property'], 5);
  for (const line of ['WC', 'GL'] as const) {
    let ceded = 0, byLayer = [0, 0, 0, 0], above = 0, gross = 0;
    for (const r of locked) {
      const lr = r.byLine[line]!;
      const totals = occurrenceTotals(lr.claims ?? [], lr.occurrences ?? []);
      gross += totals.reduce((a, b) => a + b, 0);
      lr.cededByLayer.forEach((v, i) => { byLayer[i] += v; });
      ceded += lr.cededByLayer.reduce((a, b) => a + b, 0);
      above += lr.retainedAboveTower;
    }
    console.log(`  ${line}: 5-yr ceded ${fmt$(ceded)} of ${fmt$(gross)} occurrence total (${(ceded / gross * 100).toFixed(1)}%)`);
    console.log(`     by layer ${REINSURANCE_TOWER[line].map((l, i) => `${l.name} ${fmt$(byLayer[i])}`).join(' | ')}`);
    console.log(`     retained above tower ${fmt$(above)}`);
    console.log(`     ceded is a strict subset of gross: ${note(ceded <= gross + 1, `${line} ceded exceeds gross`)}`);
    if (line === 'WC') {
      // ⚠ WAS `note(byLayer[3] === 0, 'unpurchasable WC layer paid')`. Index 3 no
      // longer exists, and the layer that occupied it is now purchasable and
      // expected to pay — the assertion would have inverted from "must never pay"
      // to "must sometimes pay" without anyone noticing, because byLayer[3] reads
      // undefined and `undefined === 0` is false only after the array shortened.
      //
      // The merged band fires once per 4.6 years, so a 5-year window paying zero
      // is ORDINARY and must not be a failure. What is asserted is the structural
      // relation that holds every year: WC retains nothing above its own tower top
      // unless the merged layer is exhausted, because the tower reaches $50M.
      const wcTop = byLayer[2];
      console.log(`     merged $40M xs $10M ceded ${fmt$(wcTop)} in this 5-yr window (fires ~1 per 4.6 yrs, so 0 is ordinary)`);
      console.log(`     retained above $50M only if the merged layer is exhausted: ` +
        `${note(above === 0 || wcTop >= REINSURANCE_TOWER.WC[2].limit - 1, 'WC retained above the tower while its top layer had unused limit')}`);
    }
  }
  // Property now runs the SAME tower, one layer, $5M retention.
  const pr = locked[0].byLine.Property!;
  console.log(`  Property is on the tower now: cededByLayer populated ${note(pr.cededByLayer.length === 1, 'Property has no tower layer')}` +
    `, default decline of the aggregate ${note(pr.aggregateRecovery === 0 && pr.aggregatePremium === 0, 'Property aggregate fired on the default decision set')}` +
    `, reinsuranceCost ${fmt$(pr.reinsuranceCost)} from the occurrence layer (not REINSURANCE_PROGRAMS)`);

  // NULL TEST: decline the layer AND the aggregate — full self-insurance must
  // recover nothing and cost nothing, every year. This is what "tower declined
  // reproduces the parent byte-for-byte" reduces to as a STANDING check: the
  // one-time cross-commit comparison (against 5faf053, from an identical
  // pre-game-free bootstrap so the two products' different default pre-game
  // behaviour cannot contaminate it) is recorded in the cutover commit; this
  // is the mechanism it verified, kept runnable forever. Measured there: only
  // `attachment`/`poolLosses`/`excessLosses`/`quotaShareLosses` differed from
  // the old REINSURANCE_PROGRAMS "Self Fund" run — expected, because those are
  // display-split fields keyed off `attachment`, and the tower's $5M retention
  // is a genuinely different number from the old model's 125%-of-expected-loss
  // attachment. Every field with real economic weight (premium, cost,
  // recovery, net/gross loss, membership, surplus) was exactly unchanged.
  const declined = play('TOWERCHK-DECLINE', ['WC', 'GL', 'Property'], 5, d => ({
    ...d, byLine: { ...d.byLine, Property: { ...d.byLine.Property, layersPlaced: [false], aggregateStopLevel: -1 } },
  }));
  let declineOk = true;
  for (const r of declined) {
    const lr = r.byLine.Property!;
    if (lr.reinsuranceRecovery !== 0 || lr.reinsuranceCost !== 0 || lr.netUltimateLoss !== lr.grossUltimateLoss) declineOk = false;
  }
  console.log(`  Property fully declined (layer + aggregate): reinsuranceRecovery, reinsuranceCost === 0 and net === gross every year: ${note(declineOk, 'declining Property\'s tower did not zero out reinsurance')}`);

  // THE AGGREGATE GATE, asserted at the engine and not only at the normalizer.
  // Ask for the aggregate WITH the layer declined — an ill-formed decision the
  // UI now prevents, but a save or a script can still express it — and the
  // engine must price and pay NOTHING for it. If aggregatePremium is ever
  // non-zero here, the gate is not on the path the engine actually takes.
  const gated = play('TOWERCHK-AGGGATE', ['WC', 'GL', 'Property'], 5, d => ({
    ...d, byLine: { ...d.byLine, Property: { ...d.byLine.Property, layersPlaced: [false], aggregateStopLevel: 1 } },
  }));
  let gateOk = true;
  for (const r of gated) {
    const lr = r.byLine.Property!;
    if (lr.aggregatePremium !== 0 || lr.aggregateRecovery !== 0 || lr.reinsuranceCost !== 0) gateOk = false;
  }
  console.log(`  Property aggregate requested with the layer DECLINED: premium, recovery, reinsuranceCost all 0 every year: ` +
    `${note(gateOk, 'the aggregate gate is not reaching the engine — an aggregate was priced over a fully-declined tower')}`);
  // And it is CONDITIONAL, not the layer mandatory: with the layer placed the
  // same request goes through untouched. A gate that swallowed the aggregate
  // unconditionally would also pass the check above.
  console.log(`  with the layer PLACED the same level passes through: ` +
    `${note(normalizeAggregateStopLevel('Property', [true], 1) === 1, 'the gate suppressed a legitimate aggregate')}`);
  // WC IS NOW GATED THE SAME WAY, one commit after Property so that commit's
  // line control stayed clean. Measured: all three layers declined, WC's
  // aggregate attaches at $19.17M with a $17.42M limit, so it tops out at
  // $36.59M — and WC severity is UNBOUNDED, so the exposed band is LARGER
  // than Property's, whose worst case is at least finite. Same two-sided
  // check as Property's above: the gate bites with everything declined, and
  // a layer-placed request still passes through untouched.
  const wcGated = play('TOWERCHK-WCAGGGATE', ['WC', 'GL', 'Property'], 5, d => ({
    ...d, byLine: { ...d.byLine, WC: { ...d.byLine.WC, layersPlaced: [false, false, false], aggregateStopLevel: 1 } },
  }));
  let wcGateOk = true;
  for (const r of wcGated) {
    const lr = r.byLine.WC!;
    // reinsuranceCost, NOT asserted to 0: with all occurrence layers declined
    // it already excludes their premium, but the field also carries whatever
    // GL's or Property's cost happened to be summed elsewhere in a pool-scope
    // read — checking aggregatePremium/aggregateRecovery directly is the
    // precise assertion, same as Property's above.
    if (lr.aggregatePremium !== 0 || lr.aggregateRecovery !== 0) wcGateOk = false;
  }
  console.log(`  WC aggregate requested with ALL THREE layers declined: premium, recovery all 0 every year: ` +
    `${note(wcGateOk, 'the WC aggregate gate is not reaching the engine — an aggregate was priced over a fully-declined tower')}`);
  console.log(`  with a layer PLACED the same level passes through: ` +
    `${note(normalizeAggregateStopLevel('WC', [true, false, false], 1) === 1, 'the WC gate suppressed a legitimate aggregate')}`);
  // ⚠ ONE LAYER IS ENOUGH, not all three. The condition is "some layer
  // placed", the same test Property's uses — WC's three-layer tower must not
  // read as "everything or nothing".
  console.log(`  one of three layers is enough to enable it: ` +
    `${note(normalizeAggregateStopLevel('WC', [false, true, false], 1) === 1, 'a single placed layer did not enable the WC aggregate')}`);
}

console.log(problems.length === 0
  ? '\nALL REINSURANCE TOWER CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
