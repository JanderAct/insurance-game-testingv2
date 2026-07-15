// Investment engine for Risk Pool Simulation v1

import { SeededRandom } from './random';

export interface InvestmentResult {
  returnRate: number;
  income: number;
  isShockYear: boolean;
}

interface InvestmentRiskAssumption {
  expectedReturn: number;
  standardDeviation: number;
  minReturn: number;
  maxReturn: number;
  shockProbability: number;
  shockMeanReturn: number;
  shockStandardDeviation: number;
}

const INVESTMENT_RISK_TABLE: Record<number, InvestmentRiskAssumption> = {
  0: {
    expectedReturn: 0.0075,
    standardDeviation: 0.0025,
    minReturn: 0.0000,
    maxReturn: 0.0150,
    shockProbability: 0.01,
    shockMeanReturn: -0.0050,
    shockStandardDeviation: 0.0025,
  },
  1: {
    expectedReturn: 0.0100,
    standardDeviation: 0.0035,
    minReturn: 0.0000,
    maxReturn: 0.0200,
    shockProbability: 0.015,
    shockMeanReturn: -0.0075,
    shockStandardDeviation: 0.0035,
  },
  2: {
    expectedReturn: 0.0125,
    standardDeviation: 0.0050,
    minReturn: -0.0025,
    maxReturn: 0.0275,
    shockProbability: 0.020,
    shockMeanReturn: -0.0100,
    shockStandardDeviation: 0.0050,
  },
  3: {
    expectedReturn: 0.0150,
    standardDeviation: 0.0075,
    minReturn: -0.0075,
    maxReturn: 0.0350,
    shockProbability: 0.025,
    shockMeanReturn: -0.0150,
    shockStandardDeviation: 0.0075,
  },
  4: {
    expectedReturn: 0.0175,
    standardDeviation: 0.0100,
    minReturn: -0.0125,
    maxReturn: 0.0425,
    shockProbability: 0.030,
    shockMeanReturn: -0.0200,
    shockStandardDeviation: 0.0100,
  },
  5: {
    expectedReturn: 0.0200,
    standardDeviation: 0.0135,
    minReturn: -0.0200,
    maxReturn: 0.0500,
    shockProbability: 0.035,
    shockMeanReturn: -0.0300,
    shockStandardDeviation: 0.0125,
  },
  6: {
    expectedReturn: 0.0225,
    standardDeviation: 0.0175,
    minReturn: -0.0300,
    maxReturn: 0.0600,
    shockProbability: 0.040,
    shockMeanReturn: -0.0400,
    shockStandardDeviation: 0.0150,
  },
  7: {
    expectedReturn: 0.0250,
    standardDeviation: 0.0225,
    minReturn: -0.0400,
    maxReturn: 0.0700,
    shockProbability: 0.045,
    shockMeanReturn: -0.0500,
    shockStandardDeviation: 0.0175,
  },
  8: {
    expectedReturn: 0.0275,
    standardDeviation: 0.0275,
    minReturn: -0.0500,
    maxReturn: 0.0800,
    shockProbability: 0.050,
    shockMeanReturn: -0.0600,
    shockStandardDeviation: 0.0200,
  },
  9: {
    expectedReturn: 0.0300,
    standardDeviation: 0.0325,
    minReturn: -0.0600,
    maxReturn: 0.0900,
    shockProbability: 0.055,
    shockMeanReturn: -0.0700,
    shockStandardDeviation: 0.0250,
  },
  10: {
    expectedReturn: 0.0325,
    standardDeviation: 0.0400,
    minReturn: -0.0800,
    maxReturn: 0.1000,
    shockProbability: 0.060,
    shockMeanReturn: -0.0900,
    shockStandardDeviation: 0.0300,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getInvestmentAssumption(investmentRisk: number): InvestmentRiskAssumption {
  const roundedRisk = Math.round(clamp(investmentRisk, 0, 10));
  return INVESTMENT_RISK_TABLE[roundedRisk] ?? INVESTMENT_RISK_TABLE[3];
}

export function simulateInvestmentReturn(
  investedAssets: number,
  investmentRisk: number,
  _instanceBaseReturn: number,
  _instanceVolatility: number,
  _instanceDownsideRisk: number,
  rng: SeededRandom,
): InvestmentResult {
  const assumption = getInvestmentAssumption(investmentRisk);

  const isShockYear = rng.chance(assumption.shockProbability);

  const simulatedReturn = isShockYear
    ? rng.normal(assumption.shockMeanReturn, assumption.shockStandardDeviation)
    : rng.normal(assumption.expectedReturn, assumption.standardDeviation);

  const returnRate = clamp(
    simulatedReturn,
    assumption.minReturn,
    assumption.maxReturn
  );

  const income = investedAssets * returnRate;

  return {
    returnRate,
    income,
    isShockYear,
  };
}