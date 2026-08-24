// Rule-based narrative explanation engine for Risk Pool Simulation v1

import type { ResultSet } from '../types/simulation';

export function generateNarrative(result: ResultSet, _priorResult?: ResultSet): string {
  const parts: string[] = [];

  const { decisions, assetAllocation, actualCombinedRatio, netIncome, grossUltimateLoss, totalMemberCharge,
    reinsuranceRecovery, investmentIncome,
    newMembers, withdrawnMembers, shockLossIncurred,
    priorYearDevelopment, endingSurplus } = result;

  // --- Rate Change --- REMOVED. The Rate Change decision it narrated is gone
  // (CLF-only pricing); a narrative describing the funding-confidence-level
  // decision instead is a pending replacement, not invented here.

  // --- Underwriting ---
  if (decisions.underwritingStrictness <= 2) {
    parts.push(`With very flexible underwriting, the pool was highly accessible, supporting member growth. However, this creates adverse selection risk.`);
  } else if (decisions.underwritingStrictness >= 8) {
    parts.push(`Strict underwriting standards improved average risk quality, reducing expected losses and tail risk.`);
  }

  // --- Shock Loss ---
  if (shockLossIncurred) {
    parts.push(`A shock loss event occurred this year, significantly increasing gross losses.`);
  }

  // --- Loss Performance ---
  const lossRatio = grossUltimateLoss / Math.max(totalMemberCharge, 1);
  if (lossRatio > 0.90) {
    parts.push(`Gross loss performance was unfavorable with a loss ratio of ${pct(lossRatio)}.`);
  } else if (lossRatio < 0.55) {
    parts.push(`Gross loss performance was strong with a favorable loss ratio of ${pct(lossRatio)}.`);
  }

  // --- Combined Ratio ---
  if (actualCombinedRatio > 1.0) {
    parts.push(`The actual combined ratio was ${pct(actualCombinedRatio)}, so the year was underfunded and consumed surplus.`);
  } else if (actualCombinedRatio < 1.0) {
    parts.push(`The actual combined ratio was ${pct(actualCombinedRatio)}, leaving a funding margin that supports surplus.`);
  }

  // --- Reinsurance ---
  // ONE PRODUCT NOW. Every line runs the per-occurrence tower, so
  // resultUsesTower(result) is always true; the percentage-of-premium branch
  // this used to fall back to (keyed on the now-removed `reinsuranceLevel`)
  // is deleted rather than narrated, per the same reasoning as
  // reinsuranceDisplay.ts: a narrative describing a quota share on a line
  // with a tower would be worse than no narrative.
  {
    const anyPlaced = (result.cededByLayer ?? []).length > 0
      && (result.decisions.layersPlaced ?? []).some(Boolean);
    if (reinsuranceRecovery > 0) {
      parts.push(`The reinsurance tower recovered $${fmt(reinsuranceRecovery)}, reducing net losses.`);
    } else if (anyPlaced) {
      parts.push(`Occurrence layers were placed but no single loss reached the $1M retention.`);
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

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
