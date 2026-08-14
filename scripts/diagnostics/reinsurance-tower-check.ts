// Verification for the per-occurrence tower.
//
//   npx tsx scripts/diagnostics/reinsurance-tower-check.ts
//
// Checks the things the tower could get wrong in ways nothing else would catch:
// the cap/retention ORDER, that ceded loss matches what the layer diagnostic
// measured, that a corridor retention works, that the aggregate responds to the
// occurrence-layer selection, and — the whole point of the pricing change — that
// the price no longer moves with the funding confidence level.

import { GL_STATUTORY_CAP } from '../../src/data/defaultAssumptions';
import {
  AGG_ATTACHMENT_LEVELS, REINSURANCE_TOWER, RISK_LOAD_LAMBDA, TOWER_TOP,
} from '../../src/data/reinsuranceTower';
import {
  cedeOccurrences, claimContribution, layerMask, layerPremium,
  occurrenceProgramCost, occurrenceTotals, quoteAggregate,
} from '../../src/utils/reinsuranceTower';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { Claim, CoverageLine, DecisionSet, GameState, ResultSet } from '../../src/types/simulation';

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

console.log('=== 1. THE WATERFALL ORDER (J14): cap indemnity only, retain on the combined total ===');
{
  // A state-law claim capped on damages must STILL reach the treaty on defense
  // costs. Transposing the two rules is the easy mistake, so it is asserted on a
  // constructed claim rather than hoped for.
  const mk = (indemnity: number, alae: number, basis: 'stateLaw' | 'federal1983'): Claim => ({
    id: 'c', occurrenceId: 'o', memberId: 'm', line: 'GL', accidentYear: 1, calendarYear: 2026,
    tier: 'general', status: 'open', reportedYear: 1, grossUltimate: indemnity + alae,
    paidToDate: 0, caseReserve: indemnity + alae, indemnity, alae, legalBasis: basis,
  });
  const capped = mk(5e6, 900e3, 'stateLaw');
  const uncapped = mk(5e6, 900e3, 'federal1983');
  console.log(`  stateLaw $5.0M indemnity + $900k ALAE -> ${fmt$(claimContribution(capped, 'GL'))} ` +
    `${note(Math.abs(claimContribution(capped, 'GL') - (GL_STATUTORY_CAP + 900e3)) < 1, 'stateLaw cap not applied to indemnity only')}`);
  console.log(`  federal1983 same claim              -> ${fmt$(claimContribution(uncapped, 'GL'))} ` +
    `${note(Math.abs(claimContribution(uncapped, 'GL') - 5.9e6) < 1, 'federal1983 claim was capped')}`);
  console.log(`  the capped claim STILL pierces the $1M retention on ALAE alone: ` +
    `${note(claimContribution(capped, 'GL') > 1e6, 'capped claim wrongly kept below retention')}`);
  console.log(`  WC has no cap: ${note(claimContribution({ ...mk(9e6, 0, 'stateLaw'), line: 'WC' }, 'WC') === 9e6, 'WC claim was capped')}`);
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
  const per100 = 2.9e6; // $290M exposure
  for (const line of ['WC', 'GL'] as const) {
    const mults = REINSURANCE_TOWER[line].map(l => 1 + RISK_LOAD_LAMBDA * l.sdOverExpected);
    const rising = mults.every((m, i) => i === 0 || m > mults[i - 1]);
    console.log(`  ${line}: ${REINSURANCE_TOWER[line].map((l, i) => `${l.name} ${mults[i].toFixed(2)}x`).join('  ')}`);
    console.log(`     monotonically rising with attachment: ${note(rising, `${line} loading multiples not monotonic`)}`);
  }
  // The behaviour that validates the whole approach: GL's top layer costs MORE
  // per $100 than WC's despite a LOWER multiple, because it is more exposed.
  const glTop = layerPremium('GL', 2, per100) / per100, wcTop = layerPremium('WC', 2, per100) / per100;
  console.log(`  GL top layer ${glTop.toFixed(4)} per $100 vs WC top ${wcTop.toFixed(4)} — GL dearer on a LOWER multiple: ` +
    `${note(glTop > wcTop, 'GL top layer is not dearer than WC top')}`);
  // ⚠ WAS "the unpurchasable WC layer is excluded from program cost". THERE IS NO
  // LONGER AN UNPURCHASABLE LAYER TO EXCLUDE. $25M xs $25M was flagged
  // non-purchasable on two numeric grounds, both voided by the severity rebuild:
  // a single claim "cannot reach $25M" (the retired annuity's $15.51M PV ceiling —
  // the mixture has none, and reaches $25M once every 26 years), and SD/E of 42
  // making its price "a division artifact" (now 6.38 on a real expected cost).
  //
  // The purchasability GATE is still live code, but nothing sets the flag false
  // any more, so that branch is now untested BY DATA rather than by assertion.
  // Asserted instead: the layer that was excluded now carries a real price.
  const top = REINSURANCE_TOWER.WC[3];
  console.log(`  WC's top layer is purchasable and priced: ${top.expectedCededPer100.toFixed(4)} per $100, SD/E ${top.sdOverExpected}  ` +
    `${note(top.purchasable && top.expectedCededPer100 > 0.01 && top.sdOverExpected < 10, 'WC top layer is not priced as a real layer')}`);
  console.log(`     charged when placed: ${note(occurrenceProgramCost('WC', [false, false, false, true], per100) > 0, 'the now-purchasable top layer is still being skipped')}`);
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
  const EXPOSURE = 290, EGROSS = 12.83e6;
  const all = REINSURANCE_TOWER.WC.map(l => l.purchasable);
  const none = REINSURANCE_TOWER.WC.map(() => false);
  console.log('  att%   all layers premium    none placed premium    ratio');
  for (let lv = 0; lv < AGG_ATTACHMENT_LEVELS.length; lv++) {
    const qa = quoteAggregate(all, EXPOSURE, EGROSS, lv), qn = quoteAggregate(none, EXPOSURE, EGROSS, lv);
    const ratio = qn.premium / Math.max(qa.premium, 1);
    console.log(`  ${(AGG_ATTACHMENT_LEVELS[lv] * 100).toFixed(0)}%   ${fmt$(qa.premium).padStart(18)}    ${fmt$(qn.premium).padStart(18)}    x${ratio.toFixed(1)}  ` +
      `${note(ratio > 1.4, `aggregate barely responds to selection at ${AGG_ATTACHMENT_LEVELS[lv]} (x${ratio.toFixed(1)})`)}`);
  }
  console.log('  ^^ declining occurrence layers puts catastrophic claims back into the retention,');
  console.log('     raising retained volatility and so the aggregate\'s price. Without this,');
  console.log('     "decline everything, buy the aggregate" would be free volatility transfer.');
  // Not linear in exposure — the reason this price is computed, not frozen.
  const small = quoteAggregate(all, 145, EGROSS / 2, 1), big = quoteAggregate(all, 580, EGROSS * 2, 1);
  const rs = small.premium / (145e6 / 100), rb = big.premium / (580e6 / 100);
  console.log(`  premium per $100 at $145M exposure ${rs.toFixed(4)} vs $580M ${rb.toFixed(4)} — FALLS as the book grows: ` +
    `${note(rb < rs, 'aggregate price per $100 did not fall with exposure — linearity bug')}`);
  console.log(`  mask indexing is total (16 entries for 4 layers): ${note(layerMask([true, false, true, true]) === 13, 'layerMask wrong')}`);
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
      const totals = occurrenceTotals(lr.claims ?? [], lr.occurrences ?? [], line);
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
      const wcTop = byLayer[3];
      console.log(`     WC's unpurchasable top layer ceded nothing: ${note(wcTop === 0, 'unpurchasable WC layer paid')}`);
    }
  }
  // Property must be untouched by all of this.
  const pr = locked[0].byLine.Property!;
  console.log(`  Property still on the LEGACY path: cededByLayer empty ${note(pr.cededByLayer.length === 0, 'Property got tower layers')}` +
    `, aggregate zero ${note(pr.aggregateRecovery === 0 && pr.aggregatePremium === 0, 'Property got a tower aggregate')}` +
    `, reinsuranceCost ${fmt$(pr.reinsuranceCost)} from REINSURANCE_PROGRAMS`);
}

console.log(problems.length === 0
  ? '\nALL REINSURANCE TOWER CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
