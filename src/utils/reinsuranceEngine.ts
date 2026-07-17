// Reinsurance engine for Risk Pool Simulation v1
// Aggregate quota share above expected loss: attachment is fixed at 100% of expected
// gross loss for every paid level, and the reinsurer pays a flat, uncapped quota share
// of losses above that. Levels 1-4 carry limitPctOfPremium = Infinity, so the limit
// cap in calculateReinsuranceRecovery below is a no-op for them (Math.min against
// Infinity always returns the other operand).

import type { ReinsuranceStructure } from '../types/simulation';
import { REINSURANCE_PROGRAMS } from '../data/defaultAssumptions';

// Get the resolved reinsurance structure for a given protection level
export function getReinsuranceStructure(
  level: number,
  annualPremium: number,
  expectedGrossLoss: number,
): ReinsuranceStructure {
  const prog = REINSURANCE_PROGRAMS[Math.max(0, Math.min(4, level))];

  const attachment = expectedGrossLoss * prog.attachmentMultiplierOfExpectedLoss;
  const limit = annualPremium * prog.limitPctOfPremium;
  const midCostPct = (prog.costPctOfPremiumMin + prog.costPctOfPremiumMax) / 2;

  return {
    level: prog.level,
    label: prog.label,
    attachment,
    limit,
    recoveryPct: prog.recoveryPct,
    costPctOfPremium: midCostPct,
  };
}

// Calculate reinsurance cost for the year
export function calculateReinsuranceCost(
  level: number,
  annualPremium: number,
  competitivePressure: number,
): number {
  if (level === 0) return 0;
  const prog = REINSURANCE_PROGRAMS[Math.max(0, Math.min(4, level))];
  const t = competitivePressure;
  const costPct = prog.costPctOfPremiumMax - t * (prog.costPctOfPremiumMax - prog.costPctOfPremiumMin);
  return annualPremium * costPct;
}

// Calculate reinsurance recovery on actual gross losses
export function calculateReinsuranceRecovery(
  grossLoss: number,
  structure: ReinsuranceStructure,
): number {
  if (structure.level === 0 || structure.limit === 0) return 0;
  const recoverableLoss = Math.max(0, grossLoss - structure.attachment);
  const recovery = Math.min(recoverableLoss * structure.recoveryPct, structure.limit);
  return Math.max(0, recovery);
}