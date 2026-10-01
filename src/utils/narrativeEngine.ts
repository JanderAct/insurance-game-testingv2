// Rule-based narrative explanation engine for Risk Pool Simulation v1

import type { ResultSet } from '../types/simulation';
import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import { normalizeLayersPlaced } from './reinsuranceTower';
import { ratioBand } from './formatters';

const TOWER_LINES: readonly TowerLine[] = ['WC', 'GL', 'Property'];

export function generateNarrative(result: ResultSet, _priorResult?: ResultSet): string {
  const parts: string[] = [];

  const { assetAllocation, actualCombinedRatio, netIncome,
    actualLossRatioPricingBasis, expectedLossRatio,
    reinsuranceRecovery, investmentIncome,
    newMembers, withdrawnMembers, shockLossIncurred,
    priorYearDevelopment, endingSurplus } = result;

  // --- Rate Change --- REMOVED. The Rate Change decision it narrated is gone
  // (CLF-only pricing); a narrative describing the funding-confidence-level
  // decision instead is a pending replacement, not invented here.

  // --- Underwriting --- REMOVED WITH THE SLIDER IT NARRATED. Both branches
  // described the pool in RISK-QUALITY terms ("improved average risk
  // quality"), which is an attribute the player can no longer see per member
  // and which the retired strictness screen selected on directly. A narrative
  // for the experience modifier is a pending replacement, not invented here —
  // the same treatment the Rate Change narrative got above.

  // --- Shock Loss ---
  if (shockLossIncurred) {
    parts.push(`A shock loss event occurred this year, significantly increasing gross losses.`);
  }

  // --- Loss Performance ---
  // ⚠ THIS WAS A FOURTH BASIS AND IT CONTRADICTED THE SCREEN IT SAT ON.
  // It read `grossUltimateLoss / totalMemberCharge` — a GROSS numerator over the
  // MEMBER-CHARGE denominator, a combination used nowhere else in the app — and
  // printed the result as "a loss ratio of X". With the headline on the pricing
  // basis, the same year could show 73% in the chip and prose calling it "a
  // favorable loss ratio of 52%". Two numbers, two bases, one screen.
  //
  // ⚠ AND IT WAS NOT INERT, CONTRARY TO A REPORT OF MINE. That report said the
  // prose "sits permanently in the silent middle and never fires", reasoning
  // from the 66.8% POOLED DOLLAR-WEIGHTED average to the per-year firing rate.
  // Those are different statistics. Measured per year over 1,200 pooled
  // observations it fired low on 38.8% and high on 16.7%, silent on 44.6% — so
  // it fired on more than half of all years, on the wrong basis, in prose a
  // player reads. The correction matters because it makes this a live defect
  // rather than dead code.
  //
  // ⚠ THE THRESHOLDS ARE THE HEADER'S, SHARED FROM ONE PLACE, AND THEY ARE
  // ABSOLUTE. They used to be 0.65 and 0.95, anchored on the PRICED expectation —
  // which made the verdict relative to the player's own aggression. A pool
  // funding at 40% and running 0.95 is burning surplus, and calling that
  // favourable because it beat its own price rewards the underpricing. This game
  // exists to show the consequences of aggressive pricing, not to grade a player
  // against it. 1.00 is the line between making and losing money on underwriting;
  // 0.65 and 0.95 marked nothing.
  //
  // ⚠ AND THE VERDICT WORDING HAD TO BECOME ABSOLUTE WITH THE CUTOFF, WHICH THE
  // CUTOFF CHANGE ALONE WOULD HAVE MISSED. The old favourable sentence said
  // "performance was STRONG at X%, against roughly Y% priced". Under the new band
  // that fires below 1.00 against a priced expectation of ~80% at member funding,
  // so it would have printed "strong at 89%, against roughly 80% priced" —
  // praising a year that underperformed its own price. That is the same defect
  // one step along. The sentence states what the ratio DID now; the priced figure
  // stays as context, never as the standard.
  //
  // MEASURED at 70-85% funding, 24 games x 10 years, 720 line-years:
  //   <0.90 83.6%   0.90-1.00 6.7%   1.00-1.10 3.8%   >=1.10 6.0%
  // so it speaks critically on 9.7% of line-years (the old pair: 12.2%) and
  // 2.5% of pool-years. The criticism barely moved; what the ruling changed is
  // the favourable side, 44.4% -> 83.6%, which is why its wording is flat.
  const lossRatio = actualLossRatioPricingBasis;
  const priced = `against roughly ${pct(expectedLossRatio)} priced`;
  const band = ratioBand(lossRatio);
  if (band === 3) {
    parts.push(`Net losses ran to ${pct(lossRatio)} of premium and admin expense — well past the point where underwriting pays for itself, ${priced}.`);
  } else if (band === 2) {
    parts.push(`Net losses exceeded premium and admin expense at ${pct(lossRatio)}, so underwriting lost money this year, ${priced}.`);
  } else if (band === 0) {
    parts.push(`Net losses ran to ${pct(lossRatio)} of premium and admin expense, covering the year's underwriting with margin, ${priced}.`);
  }

  // --- Combined Ratio ---
  // ⚠ IT SPEAKS TO UNDERWRITING ONLY. IT USED TO CLAIM A SURPLUS OUTCOME AND
  // CONTRADICTED THE NET-INCOME SENTENCE BELOW ON 9.2% OF POOL-YEARS.
  // The combined ratio excludes investment income; net income includes it. So a
  // year could read "consumed surplus" here and "strengthening surplus to $X"
  // four sentences later, both printed, both wrong to a reader trying to
  // reconcile them. Measured over 240 pool-years at member funding: 22 said
  // consumed-but-positive, 1 said supported-but-negative.
  //
  // Surplus is the net-income sentence's claim to make, because net income is
  // what moves it. This one says what underwriting did, and names the exclusion
  // so the two read as a sequence rather than a disagreement.
  if (actualCombinedRatio > 1.0) {
    parts.push(`The actual combined ratio was ${pct(actualCombinedRatio)}, so underwriting did not pay for itself before investment income.`);
  } else if (actualCombinedRatio < 1.0) {
    parts.push(`The actual combined ratio was ${pct(actualCombinedRatio)}, so underwriting paid for itself before investment income.`);
  }

  // --- Reinsurance ---
  // ONE PRODUCT NOW. Every line runs the per-occurrence tower, so
  // resultUsesTower(result) is always true; the percentage-of-premium branch
  // this used to fall back to (keyed on the now-removed `reinsuranceLevel`)
  // is deleted rather than narrated, per the same reasoning as
  // reinsuranceDisplay.ts: a narrative describing a quota share on a line
  // with a tower would be worse than no narrative.
  //
  // ⚠ PER LINE, FROM EACH LINE'S OWN DECISIONS AND TOWER. This is the POOLED
  // result, and it used to read `result.decisions` — which the pool copies from
  // its FIRST line — and `result.cededByLayer`, which deliberately excludes
  // Property. So a Property-only pool that bought its layer was told "No
  // occurrence layers were placed", and every pool was told of "the $1M
  // retention" although Property's lowest layer attaches at $5M and a player
  // who declines a line's first layer retains up to the next one. Each line now
  // names the attachment of its own lowest PLACED layer, from the tower itself.
  {
    const lowestPlaced = TOWER_LINES
      .filter(line => result.byLine?.[line])
      .map(line => {
        const placed = normalizeLayersPlaced(line, result.byLine[line].decisions.layersPlaced);
        const attachments = REINSURANCE_TOWER[line].filter((_, i) => placed[i]).map(l => l.attachment);
        return { line, attachment: attachments.length > 0 ? Math.min(...attachments) : null };
      })
      .filter((x): x is { line: TowerLine; attachment: number } => x.attachment !== null);
    // ⚠ TWO PRODUCTS, TWO SENTENCES. This said "The reinsurance tower recovered
    // $X" and passed `reinsuranceRecovery`, which simulationEngine builds as
    // `cession.totalCeded + aggregateRecoveryAmount` — the per-occurrence tower
    // PLUS the aggregate stop. So a year whose tower paid nothing and whose
    // aggregate stop paid everything was told the tower recovered it, and the
    // two products are bought separately, attach differently and are worth
    // different things to a player deciding what to renew.
    //
    // The tower's own figure is the difference. Each is named only when it paid,
    // so a pool with no aggregate stop reads exactly as before.
    const aggRecovery = result.aggregateRecovery ?? 0;
    const towerRecovery = reinsuranceRecovery - aggRecovery;
    if (towerRecovery > 0 || aggRecovery > 0) {
      if (towerRecovery > 0) {
        parts.push(`The occurrence tower recovered $${fmt(towerRecovery)}, reducing net losses.`);
      }
      if (aggRecovery > 0) {
        // "a further" only when the tower also paid — on its own it is the first
        // recovery of the year, not an addition to one.
        const further = towerRecovery > 0 ? 'a further ' : '';
        parts.push(`The aggregate stop recovered ${further}$${fmt(aggRecovery)} once the year's retained losses passed its attachment.`);
      }
    } else if (lowestPlaced.length > 0) {
      const where = lowestPlaced.map(x => `${x.line} at $${fmtM(x.attachment)}`).join(', ');
      parts.push(`Occurrence layers were placed but no single loss reached the lowest one placed (${where}).`);
    } else {
      parts.push(`No occurrence layers were placed — the pool retained every loss in full.`);
    }
    const above = result.retainedAboveTower ?? 0;
    if (above > 0) {
      parts.push(`$${fmt(above)} fell ABOVE the top of the tower and could not be reinsured at any price.`);
    }
  }

  // --- Investment ---
  if (assetAllocation.equitiesPct >= 50) {
    if (investmentIncome > 0) {
      parts.push(`An equities-heavy allocation generated strong investment income of $${fmt(investmentIncome)}.`);
    } else {
      parts.push(`An equities-heavy allocation resulted in an investment loss this year.`);
    }
  } else if (assetAllocation.equitiesPct <= 15) {
    parts.push(`A cash/bonds-heavy allocation produced modest but stable investment income of $${fmt(investmentIncome)}.`);
  }

  // --- Membership ---
  if (newMembers > 3) {
    parts.push(`${newMembers} new members joined the pool this year.`);
  }
  if (withdrawnMembers > 3) {
    parts.push(`${withdrawnMembers} members withdrew from the pool.`);
  }

  // --- Funding ---
  if (result.capitalAdequacyStatus !== 'N/A') {
    if (result.capitalAdequacyStatus === 'Deficient') {
      parts.push(`The pool's excess capital position is rated ${result.capitalAdequacyStatus}, indicating a deficit relative to the required reserve margin.`);
    } else if (result.capitalAdequacyStatus === 'Thin') {
      parts.push(`The pool's excess capital position is rated ${result.capitalAdequacyStatus}, slightly below the required reserve margin.`);
    } else {
      parts.push(`The pool's excess capital position is rated ${result.capitalAdequacyStatus}.`);
    }
  }

  // --- Prior Year Development ---
  if (Math.abs(priorYearDevelopment) > 10000) {
    if (priorYearDevelopment > 0) {
      parts.push(`Prior year reserves developed favorably, releasing $${fmt(priorYearDevelopment)} to income.`);
    } else {
      parts.push(`Prior year reserves developed adversely, requiring $${fmt(Math.abs(priorYearDevelopment))} of strengthening.`);
    }
  }

  // --- Net outcome ---
  if (netIncome > 0) {
    parts.push(`Overall, the pool generated net income of $${fmt(netIncome)}, strengthening surplus to $${fmt(endingSurplus)}.`);
  } else {
    parts.push(`Overall, the pool experienced a net loss of $${fmt(Math.abs(netIncome))}, reducing surplus to $${fmt(endingSurplus)}.`);
  }

  return parts.join(' ');
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtM(n: number): string {
  return `${+(n / 1e6).toFixed(2)}M`;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
