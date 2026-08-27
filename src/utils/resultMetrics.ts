// The full year-by-year result metric list — the SINGLE source of truth for
// both the on-screen Result Spreadsheet table and the .xlsx export. Kept here
// (not inline in the page component) so every consumer — including baseline
// generation scripts — uses the same list and cannot silently drift from what
// the app actually exports.
import type { SpreadsheetMetric } from './resultsExport';
import { formatCurrency, formatPct } from './formatters';
import { placementCode, placementSummary } from './reinsuranceDisplay';
import type { CoverageLine, LineDecisionSet, ResultSet } from '../types/simulation';

// Which tower line a result row belongs to — WC or GL ONLY, never a guess.
//
// ⚠ THIS USED TO INFER IT FROM THE LAYER COUNT (`>= 4 ? 'WC' : 'GL'`), on the
// grounds that "WC's tower has 4 layers, GL's has 3". THE MERGE OF WC's TOP TWO
// LAYERS MADE BOTH THREE, so that test would have silently labelled every WC row
// 'GL' — and it would still have compiled, still have rendered, and produced a
// placement summary naming GL's layers on a WC result.
//
// ⚠ IT THEN FELL BACK TO 'GL' FOR ANY ROW WITHOUT AN EXPLICIT LINE, ON THE
// CLAIMED GROUND THAT THE POOL ROW "NEVER REACHES HERE — resultUsesTower GATES
// THE CALL." That was never true and was never tested: the pooled ResultSet
// carries no `line` (it aggregates every active line) and sums cededByLayer
// ELEMENTWISE, so resultUsesTower reads true whenever ANY tower line is
// active — which, with DEFAULT_LAYERS_PLACED, is every default game. A
// WC-solo pool row hit this fallback and printed GL's top band, $15M xs $10M,
// on a pool whose real top band is WC's $40M xs $10M. Returns undefined now
// rather than guess; poolReinsuranceLevelDetail below is what the pool row
// actually reads.
const towerLineOf = (r: { line?: CoverageLine }): CoverageLine | undefined =>
  r.line === 'WC' || r.line === 'GL' || r.line === 'Property' ? r.line : undefined;

// THE POOL ROW HAS NO SINGLE LINE, so instead of picking one it reports every
// active tower line by name. Reads r.byLine, which is present and accurate on
// every pool-scope row (populated in simulationEngine's pool aggregation from
// the SAME per-line results this file reports elsewhere) even though the type
// this function is declared against (LineResultSet) does not carry it.
function poolReinsuranceLevelDetail(
  r: { line?: CoverageLine },
  render: (line: CoverageLine, decisions: Pick<LineDecisionSet, 'layersPlaced' | 'aggregateStopLevel'>) => string,
): string {
  const byLine = (r as unknown as ResultSet).byLine;
  const active = (['WC', 'GL', 'Property'] as const).filter(l => byLine?.[l]);
  if (active.length === 0) return 'n/a';
  return active.map(l => `${l}: ${render(l, byLine[l].decisions)}`).join(' | ');
}

const dollars = (value: number) => `$${value.toFixed(2)}`;
const roundDollars = (value: number) => Math.round(value);

export const RESULT_METRICS: SpreadsheetMetric[] = [
    {
      key: 'yearNumber',
      category: 'Year',
      label: 'Year Number',
      value: r => r.yearNumber,
    },
    {
      key: 'calendarYear',
      category: 'Year',
      label: 'Calendar Year',
      value: r => r.calendarYear,
    },

    // Decisions
    // 'rateChange' REMOVED — the decision field it exported is gone
    // (CLF-only pricing). Removing an export field is a SHAPE change (the
    // hash guard will move); it is not a value change on any remaining field.
    {
      key: 'fundingConfidenceLevel',
      category: 'Decisions',
      label: 'Funding Confidence Level',
      value: r => formatPct(r.selectedFundingConfidenceLevel, 0),
      csvValue: r => r.selectedFundingConfidenceLevel,
    },
    {
      key: 'selectedFundingCLF',
      category: 'Decisions',
      label: 'Selected CLF',
      value: r => r.selectedFundingCLF.toFixed(3),
      csvValue: r => r.selectedFundingCLF,
    },
    {
      key: 'dividendPct',
      category: 'Decisions',
      label: 'Dividend %',
      value: r => formatPct(r.decisions.dividendPct, 1),
      csvValue: r => r.decisions.dividendPct,
    },
    {
      key: 'assessmentPct',
      category: 'Decisions',
      label: 'Assessment %',
      value: r => formatPct(r.decisions.assessmentPct, 1),
      csvValue: r => r.decisions.assessmentPct,
    },
    {
      key: 'underwritingStrictness',
      category: 'Decisions',
      label: 'Underwriting Strictness',
      value: r => r.decisions.underwritingStrictness,
    },
    {
      key: 'riskControlPct',
      category: 'Decisions',
      label: 'Risk Control %',
      value: r => formatPct(r.decisions.riskControlPct, 1),
      csvValue: r => r.decisions.riskControlPct,
    },
    {
      // ONE PRODUCT NOW, and REINSURANCE_PROGRAMS is gone rather than merely
      // dead — all three lines run the per-occurrence tower.
      //
      // csvValue is a STRING (a placement code like "L1+L2+L3+AGG1"), so
      // value-identity — which is numeric-only — does not see a numeric field
      // here. That is correct: a placement is not a magnitude, and pretending
      // it is one is what the old column did.
      key: 'reinsuranceLevel',
      category: 'Decisions',
      label: 'Reinsurance Program',
      value: r => {
        const line = towerLineOf(r);
        return line ? placementSummary(line, r.decisions) : poolReinsuranceLevelDetail(r, placementSummary);
      },
      csvValue: r => {
        const line = towerLineOf(r);
        return line ? placementCode(line, r.decisions) : poolReinsuranceLevelDetail(r, placementCode);
      },
    },
    {
      key: 'assetAllocation',
      category: 'Decisions',
      label: 'Asset Allocation',
      value: r => `Cash ${r.assetAllocation.cashPct.toFixed(0)}% / Bonds ${r.assetAllocation.bondsPct.toFixed(0)}% / Equities ${r.assetAllocation.equitiesPct.toFixed(0)}%`,
    },

    // Membership
    //
    // ⚠ TWO COLUMNS ON PURPOSE, AND THE SECOND IS NOT A DUPLICATE. At line scope
    // they are equal. At pool scope Members is the distinct roster and
    // Enrolments is that roster summed per line, so a member carrying WC and GL
    // appears once in the first and twice in the second — measured 141 against
    // 205 on a three-line book.
    //
    // Both ship because BOTH are needed. Members is what the pages show and what
    // a player means by the word. Enrolments is the weight behind Member
    // Satisfaction and Average Risk Quality below: those average each line's
    // figure weighted by that line's enrolments, so anyone reconstructing either
    // from this export divides by Enrolments, not Members. Shipping only Members
    // would make both unreconstructable; shipping only Enrolments is what made
    // the export read 205 where the page read 141.
    {
      key: 'activeMembers',
      category: 'Membership',
      label: 'Members',
      value: r => r.activeMembers,
    },
    {
      key: 'enrolmentCount',
      category: 'Membership',
      label: 'Enrolments',
      value: r => r.enrolmentCount,
    },
    {
      key: 'newMembers',
      category: 'Membership',
      label: 'New Members',
      value: r => r.newMembers,
    },
    {
      key: 'withdrawnMembers',
      category: 'Membership',
      label: 'Withdrawn Members',
      value: r => r.withdrawnMembers,
    },
    {
      key: 'memberRetentionRate',
      category: 'Membership',
      label: 'Member Retention Rate',
      value: r => formatPct(r.memberRetentionRate),
      csvValue: r => r.memberRetentionRate,
    },
    {
      key: 'memberSatisfaction',
      category: 'Membership',
      label: 'Member Satisfaction',
      value: r => r.memberSatisfaction.toFixed(2),
      csvValue: r => r.memberSatisfaction,
    },
    {
      key: 'averageRiskQuality',
      category: 'Membership',
      label: 'Average Risk Quality',
      value: r => r.averageRiskQuality.toFixed(2),
      csvValue: r => r.averageRiskQuality,
    },
    {
      key: 'activeExposure',
      category: 'Membership',
      label: 'Active Payroll Exposure ($M)',
      value: r => r.activeExposure.toFixed(2),
      csvValue: r => r.activeExposure,
    },
    {
      key: 'totalMarketExposure',
      category: 'Membership',
      label: 'Total Market Payroll ($M)',
      value: r => r.totalMarketExposure.toFixed(2),
      csvValue: r => r.totalMarketExposure,
    },
    {
      key: 'marketShare',
      category: 'Membership',
      label: 'Market Share',
      value: r => formatPct(r.marketShare),
      csvValue: r => r.marketShare,
    },

    // Rate and premium
    {
      key: 'rateLevel',
      category: 'Rate and Premium',
      label: 'Rate Level Index',
      value: r => r.rateLevel.toFixed(3),
      csvValue: r => r.rateLevel,
    },
    {
      key: 'purePremiumRatePer100',
      category: 'Rate and Premium',
      label: 'Pure Premium Rate per $100 Payroll',
      value: r => dollars(r.purePremiumPer100),
      csvValue: r => r.purePremiumPer100,
    },
    {
      // The term poolPremiumRateAtSelectedClf below could not previously be
      // reconciled to purePremiumRatePer100 above: the pool premium funds NET
      // expected loss (see simulationEngine.ts's net-funding note) while pure
      // premium is GROSS, and the gap between them was two engine locals no
      // export or audit-page row could reach — an export figure the reader
      // could not reproduce from anything else on the sheet.
      key: 'expectedCededPer100',
      category: 'Rate and Premium',
      label: 'Expected Ceded per $100 Payroll',
      value: r => dollars(r.expectedCededPer100),
      csvValue: r => r.expectedCededPer100,
    },
    {
      key: 'netPurePremiumRatePer100',
      category: 'Rate and Premium',
      label: 'Net Pure Premium Rate per $100 Payroll',
      value: r => dollars(r.netPurePremiumPer100),
      csvValue: r => r.netPurePremiumPer100,
    },
    {
      key: 'poolPremiumRateAtSelectedClf',
      category: 'Rate and Premium',
      label: 'Pool Premium Rate at Selected CLF',
      value: r => dollars(r.poolPremium / Math.max(r.activeExposure * 10_000, 1)),
      csvValue: r => r.poolPremium / Math.max(r.activeExposure * 10_000, 1),
    },
    {
      key: 'totalMemberRatePer100',
      category: 'Rate and Premium',
      label: 'Gross Premium & Admin Expense Rate per $100',
      value: r => dollars(r.ratePer100),
      csvValue: r => r.ratePer100,
    },
    {
      key: 'writtenExposure',
      category: 'Rate and Premium',
      label: 'Written Payroll ($M)',
      value: r => r.writtenExposure.toFixed(2),
      csvValue: r => r.writtenExposure,
    },
    {
      key: 'purePremiumAtOne',
      category: 'Rate and Premium',
      label: 'Pure Premium',
      value: r => formatCurrency(r.expectedLoss),
      csvValue: r => roundDollars(r.expectedLoss),
    },
    {
      key: 'poolPremium',
      category: 'Rate and Premium',
      label: 'Pool Premium at Selected CLF',
      value: r => formatCurrency(r.poolPremium),
      csvValue: r => roundDollars(r.poolPremium),
    },
    {
      key: 'adminExpense',
      category: 'Rate and Premium',
      label: 'Admin Expense',
      value: r => formatCurrency(r.adminExpense),
      csvValue: r => roundDollars(r.adminExpense),
    },
    {
      key: 'totalMemberCharge',
      category: 'Rate and Premium',
      label: 'Gross Premium & Admin Expense',
      value: r => formatCurrency(r.totalMemberCharge),
      csvValue: r => roundDollars(r.totalMemberCharge),
    },
    {
      key: 'assessments',
      category: 'Rate and Premium',
      label: 'Assessments',
      value: r => formatCurrency(r.assessments),
      csvValue: r => roundDollars(r.assessments),
    },
    {
      key: 'dividends',
      category: 'Rate and Premium',
      label: 'Dividends / Returned Pool Premium',
      value: r => formatCurrency(r.dividends),
      csvValue: r => roundDollars(r.dividends),
    },

    // Losses
    {
      key: 'expectedLoss',
      category: 'Losses',
      label: 'Pure Premium',
      value: r => formatCurrency(r.expectedLoss),
      csvValue: r => roundDollars(r.expectedLoss),
    },
    {
      // ⚠ WAS ALSO LABELLED "Pool Premium at Selected CLF" — the same string as
      // the poolPremium row in Rate and Premium, on the same sheet, holding a
      // different number. It IS gross expectedLoss x CLF, which stopped being
      // the pool premium when funding moved to the net basis: it now runs 39%
      // above the real poolPremium on WC and 77% on GL.
      //
      // RENAMED, NOT RETIRED, though retiring was the alternative and it has no
      // engine consumer (grep: computed at simulationEngine.ts:1175, stored,
      // pool-summed, read only here and by the audit page). The defect reported
      // is the label collision, and renaming closes it completely; deleting a
      // stored engine field is a different and larger change — it drops one of
      // the audit page's integrity checks with it — and belongs in its own
      // commit if the column is genuinely unwanted.
      key: 'clfAdjustedExpectedLoss',
      category: 'Losses',
      label: 'CLF-Adjusted Gross Expected Loss',
      value: r => formatCurrency(r.clfAdjustedExpectedLoss),
      csvValue: r => roundDollars(r.clfAdjustedExpectedLoss),
    },
    {
      key: 'aggregateMemberLoss',
      category: 'Losses',
      label: 'Member-Level Simulated Loss incl. Shared Events',
      value: r => formatCurrency(r.aggregateMemberLoss ?? r.grossUltimateLoss),
      csvValue: r => roundDollars(r.aggregateMemberLoss ?? r.grossUltimateLoss),
    },
    {
      key: 'commonLossFactor',
      category: 'Losses',
      label: 'Shared Annual Loss Factor',
      value: r => (r.commonLossFactor ?? 1).toFixed(4),
      csvValue: r => r.commonLossFactor ?? 1,
    },
    {
      key: 'catastropheFactor',
      category: 'Losses',
      label: 'Catastrophe Factor',
      value: r => (r.catastropheFactor ?? 1).toFixed(4),
      csvValue: r => r.catastropheFactor ?? 1,
    },
    {
      key: 'shockLossAmount',
      category: 'Losses',
      label: 'Shock Uplift (included in simulated loss)',
      value: r => formatCurrency(r.shockLossAmount ?? 0),
      csvValue: r => roundDollars(r.shockLossAmount ?? 0),
    },
    {
      key: 'grossUltimateLoss',
      category: 'Losses',
      label: 'Gross Ultimate Loss + LAE',
      value: r => formatCurrency(r.grossUltimateLoss),
      csvValue: r => roundDollars(r.grossUltimateLoss),
    },
    {
      key: 'shockLossIncurred',
      category: 'Losses',
      label: 'Shock Loss Incurred',
      value: r => (r.shockLossIncurred ? 'Yes' : 'No'),
    },
    {
      // ⚠ "(current year)" IS NOT DECORATION. There are two reinsurance recovery
      // lines now — this one on the year's own claims, and one on prior-year
      // development in the Reserves block below. Leaving this one unqualified made
      // the other read as a subdivision of it rather than a separate event.
      key: 'reinsuranceRecovery',
      category: 'Losses',
      label: 'Reinsurance Recovery (current year)',
      value: r => formatCurrency(r.reinsuranceRecovery),
      csvValue: r => roundDollars(r.reinsuranceRecovery),
    },
    {
      // Recovery DEFERRED by booking this year's claim register low — a
      // current-year item, sitting beside the current-year recovery it reduces.
      // Negative. Deferred rather than forgone: it comes back through the
      // prior-year development recovery below as the booking unwinds. Reads $0
      // whenever the line is funded at or above break-even.
      key: 'bookingGiveBack',
      category: 'Losses',
      label: 'Recovery deferred by optimistic booking',
      value: r => formatCurrency(r.bookingGiveBack),
      csvValue: r => roundDollars(r.bookingGiveBack),
    },
    {
      key: 'netUltimateLoss',
      category: 'Losses',
      label: 'Net Ultimate Loss + LAE',
      value: r => formatCurrency(r.netUltimateLoss),
      csvValue: r => roundDollars(r.netUltimateLoss),
    },

    // Expenses and income
    {
      key: 'operatingExpense',
      category: 'Expenses and Income',
      label: 'Operating Expense',
      value: r => formatCurrency(r.operatingExpense),
      csvValue: r => roundDollars(r.operatingExpense),
    },
    {
      key: 'riskControlInvestment',
      category: 'Expenses and Income',
      label: 'Risk Control Investment',
      value: r => formatCurrency(r.riskControlInvestment),
      csvValue: r => roundDollars(r.riskControlInvestment),
    },
    {
      key: 'reinsuranceCost',
      category: 'Expenses and Income',
      label: 'Reinsurance Cost',
      value: r => formatCurrency(r.reinsuranceCost),
      csvValue: r => roundDollars(r.reinsuranceCost),
    },
    {
      key: 'investedAssets',
      category: 'Expenses and Income',
      label: 'Invested Assets',
      value: r => formatCurrency(r.investedAssets),
      csvValue: r => roundDollars(r.investedAssets),
    },
    {
      key: 'investmentReturnRate',
      category: 'Expenses and Income',
      label: 'Investment Return Rate',
      value: r => formatPct(r.investmentReturnRate),
      csvValue: r => r.investmentReturnRate,
    },
    {
      key: 'investmentIncome',
      category: 'Expenses and Income',
      label: 'Investment Income',
      value: r => formatCurrency(r.investmentIncome),
      csvValue: r => roundDollars(r.investmentIncome),
    },
    {
      key: 'netIncome',
      category: 'Expenses and Income',
      label: 'Net Income',
      value: r => formatCurrency(r.netIncome),
      csvValue: r => roundDollars(r.netIncome),
    },

    // Reserves
    //
    // ⚠ GROSS, RECOVERY, NET — the same three rows the Accounting Reserves card
    // shows, in the same order. The workbook used to carry ONE column called
    // "Prior-Year Development" whose value was NET, with nothing about the
    // recovery taken on it: a reader saw -$215,030 of development and had no way
    // to know $3,205,174 had been ceded on it. That is the defect 22d370b fixed on
    // screen and left live here.
    {
      // ⚠ DERIVED, AND CARRIED AS ITS OWN COLUMN RATHER THAN LEFT TO THE READER.
      // It is exactly net minus ceded, so a fourth column is redundant data in the
      // strict sense — but the defect being fixed is a figure whose meaning lived
      // somewhere else, and asking a spreadsheet reader to subtract two columns to
      // recover the headline number reproduces that in a smaller form. gross /
      // ceded / net is also the triple an actuary expects to be given, not to
      // assemble. It cannot drift from its components: it is computed from them at
      // emit time.
      //
      // SIGN: priorYearDevelopment is FAVOURABLE-POSITIVE and ceding makes an
      // adverse year less adverse, so gross is net MINUS the recovery and reads
      // more negative than the net below it.
      key: 'priorYearDevelopmentGross',
      category: 'Reserves',
      label: 'Prior-Year Development (gross)',
      value: r => formatCurrency(r.priorYearDevelopment - r.priorYearDevelopmentCeded),
      csvValue: r => roundDollars(r.priorYearDevelopment - r.priorYearDevelopmentCeded),
    },
    {
      key: 'priorYearDevelopmentCeded',
      category: 'Reserves',
      label: 'Reinsurance Recovery (prior-year development)',
      value: r => formatCurrency(r.priorYearDevelopmentCeded),
      csvValue: r => roundDollars(r.priorYearDevelopmentCeded),
    },
    {
      // RENAMED. The value did not move; the label was wrong. "Prior-Year
      // Development" on a net figure invites a workbook reader to take it as
      // gross, which is the whole confusion.
      key: 'priorYearDevelopment',
      category: 'Reserves',
      label: 'Prior-Year Development (net)',
      value: r => formatCurrency(r.priorYearDevelopment),
      csvValue: r => roundDollars(r.priorYearDevelopment),
    },
    {
      key: 'beginningNetReserve',
      category: 'Reserves',
      label: 'Beginning Net Reserve',
      value: r => formatCurrency(r.beginningNetReserve),
      csvValue: r => roundDollars(r.beginningNetReserve),
    },
    {
      key: 'currentYearNetReserve',
      category: 'Reserves',
      label: 'Current-Year Net Reserve',
      value: r => formatCurrency(r.currentYearNetReserve),
      csvValue: r => roundDollars(r.currentYearNetReserve),
    },
    {
      key: 'netPaidLosses',
      category: 'Reserves',
      label: 'Net Paid Losses',
      value: r => formatCurrency(r.netPaidLosses),
      csvValue: r => roundDollars(r.netPaidLosses),
    },
    {
      key: 'endingNetReserve',
      category: 'Reserves',
      label: 'Ending Net Reserve',
      value: r => formatCurrency(r.endingNetReserve),
      csvValue: r => roundDollars(r.endingNetReserve),
    },
    {
      key: 'expectedNetUnpaidLoss',
      category: 'Reserves',
      label: 'Expected Net Unpaid Loss',
      value: r => formatCurrency(r.expectedNetUnpaidLoss),
      csvValue: r => roundDollars(r.expectedNetUnpaidLoss),
    },
    {
      key: 'indicatedNetReserveAtConfidenceLevel',
      category: 'Reserves',
      label: 'Indicated Net Reserve at Confidence',
      value: r => formatCurrency(r.indicatedNetReserveAtConfidenceLevel),
      csvValue: r => roundDollars(r.indicatedNetReserveAtConfidenceLevel),
    },
    {
      key: 'reserveRiskMarginNeeded',
      category: 'Reserves',
      label: 'Reserve Risk Margin Needed',
      value: r => formatCurrency(r.reserveRiskMarginNeeded),
      csvValue: r => roundDollars(r.reserveRiskMarginNeeded),
    },

    // Balance sheet and surplus
    {
      key: 'beginningCash',
      category: 'Balance Sheet and Surplus',
      label: 'Beginning Cash',
      value: r => formatCurrency(r.beginningCash),
      csvValue: r => roundDollars(r.beginningCash),
    },
    {
      key: 'endingCash',
      category: 'Balance Sheet and Surplus',
      label: 'Ending Cash',
      value: r => formatCurrency(r.endingCash),
      csvValue: r => roundDollars(r.endingCash),
    },
    {
      key: 'beginningInvestments',
      category: 'Balance Sheet and Surplus',
      label: 'Beginning Investments',
      value: r => formatCurrency(r.beginningInvestments),
      csvValue: r => roundDollars(r.beginningInvestments),
    },
    {
      key: 'endingInvestments',
      category: 'Balance Sheet and Surplus',
      label: 'Ending Investments',
      value: r => formatCurrency(r.endingInvestments),
      csvValue: r => roundDollars(r.endingInvestments),
    },
    {
      key: 'totalAssets',
      category: 'Balance Sheet and Surplus',
      label: 'Total Assets',
      value: r => formatCurrency(r.totalAssets),
      csvValue: r => roundDollars(r.totalAssets),
    },
    {
      key: 'unearnedPremium',
      category: 'Balance Sheet and Surplus',
      label: 'Unearned Premium',
      value: r => formatCurrency(r.unearnedPremium),
      csvValue: r => roundDollars(r.unearnedPremium),
    },
    {
      key: 'totalLiabilities',
      category: 'Balance Sheet and Surplus',
      label: 'Total Liabilities',
      value: r => formatCurrency(r.totalLiabilities),
      csvValue: r => roundDollars(r.totalLiabilities),
    },
    {
      key: 'beginingSurplus',
      category: 'Balance Sheet and Surplus',
      label: 'Beginning Surplus',
      value: r => formatCurrency(r.beginingSurplus),
      csvValue: r => roundDollars(r.beginingSurplus),
    },
    {
      key: 'surplusFromIncome',
      category: 'Balance Sheet and Surplus',
      label: 'Surplus from Income',
      value: r => formatCurrency(r.surplusFromIncome),
      csvValue: r => roundDollars(r.surplusFromIncome),
    },
    {
      key: 'endingSurplus',
      category: 'Balance Sheet and Surplus',
      label: 'Ending Surplus',
      value: r => formatCurrency(r.endingSurplus),
      csvValue: r => roundDollars(r.endingSurplus),
    },
    {
      key: 'surplusTieOutDifference',
      category: 'Balance Sheet and Surplus',
      label: 'Surplus Tie-Out Difference',
      value: r => formatCurrency(r.surplusTieOutDifference),
      csvValue: r => roundDollars(r.surplusTieOutDifference),
    },

    // Inter-line loan
    {
      key: 'loanOriginatedThisYear',
      category: 'Inter-Line Loan',
      label: 'Loan Originated This Year',
      value: r => formatCurrency(r.loanOriginatedThisYear),
      csvValue: r => roundDollars(r.loanOriginatedThisYear),
    },
    {
      key: 'loanInterestAccrued',
      category: 'Inter-Line Loan',
      label: 'Loan Interest Accrued',
      value: r => formatCurrency(r.loanInterestAccrued),
      csvValue: r => roundDollars(r.loanInterestAccrued),
    },
    {
      key: 'loanRepaymentApplied',
      category: 'Inter-Line Loan',
      label: 'Loan Repayment Applied',
      value: r => formatCurrency(r.loanRepaymentApplied),
      csvValue: r => roundDollars(r.loanRepaymentApplied),
    },
    {
      key: 'outstandingLoanBalance',
      category: 'Inter-Line Loan',
      label: 'Outstanding Loan Balance',
      value: r => formatCurrency(r.outstandingLoanBalance),
      csvValue: r => roundDollars(r.outstandingLoanBalance),
    },

    // Ratios and capital
    {
      key: 'expectedLossRatio',
      category: 'Ratios and Capital',
      // PRICING basis (poolPremium + admin). This is the finding-6
      // reconciliation figure the WC/GL 6b harness checks assert against
      // 66.8% — it is NOT a component of the combined ratio and must not be
      // added to an expense ratio.
      label: 'Expected Loss Ratio (pricing basis)',
      value: r => formatPct(r.expectedLossRatio),
      csvValue: r => r.expectedLossRatio,
    },
    {
      key: 'expectedLossRatioMemberBasis',
      category: 'Ratios and Capital',
      // MEMBER-CHARGE basis (adds reinsurance cost to the denominator). This
      // is the one that pairs with the expense ratio below.
      label: 'Expected Loss Ratio (member charge basis)',
      value: r => formatPct(r.expectedLossRatioMemberBasis),
      csvValue: r => r.expectedLossRatioMemberBasis,
    },
    {
      key: 'expectedExpenseRatio',
      category: 'Ratios and Capital',
      label: 'Expected Expense Ratio (member charge basis)',
      value: r => formatPct(r.expectedExpenseRatio),
      csvValue: r => r.expectedExpenseRatio,
    },
    {
      key: 'expectedCombinedRatio',
      category: 'Ratios and Capital',
      // Both terms on the member-charge basis. ~82.7% at the default CLF
      // 1.346, i.e. 17.3 points of intended underwriting margin; 100.0% at
      // CLF 1.0. It formerly read a hardcoded 1.000.
      label: 'Expected Combined Ratio (member charge basis)',
      value: r => formatPct(r.expectedCombinedRatio),
      csvValue: r => r.expectedCombinedRatio,
    },
    {
      key: 'actualLossRatio',
      category: 'Ratios and Capital',
      label: 'Actual Loss Ratio (member charge basis)',
      value: r => formatPct(r.actualLossRatio),
      csvValue: r => r.actualLossRatio,
    },
    {
      key: 'actualExpenseRatio',
      category: 'Ratios and Capital',
      label: 'Actual Expense Ratio (member charge basis)',
      value: r => formatPct(r.actualExpenseRatio),
      csvValue: r => r.actualExpenseRatio,
    },
    {
      key: 'actualCombinedRatio',
      category: 'Ratios and Capital',
      label: 'Actual Combined Ratio (member charge basis)',
      value: r => formatPct(r.actualCombinedRatio),
      csvValue: r => r.actualCombinedRatio,
    },
    {
      key: 'availableSurplus',
      category: 'Ratios and Capital',
      label: 'Surplus',
      value: r => formatCurrency(r.availableSurplus),
      csvValue: r => roundDollars(r.availableSurplus),
    },
    {
      key: 'excessAvailableSurplus',
      category: 'Ratios and Capital',
      label: 'Excess Available Surplus',
      value: r => formatCurrency(r.excessAvailableSurplus),
      csvValue: r => roundDollars(r.excessAvailableSurplus),
    },
    {
      key: 'excessCapitalRatio',
      category: 'Ratios and Capital',
      label: 'Excess Capital Ratio',
      value: r => r.excessCapitalRatio === null ? 'N/A' : r.excessCapitalRatio.toFixed(3),
      csvValue: r => r.excessCapitalRatio ?? '',
    },
    {
      key: 'capitalAdequacyStatus',
      category: 'Ratios and Capital',
      label: 'Excess Capital Status',
      value: r => r.capitalAdequacyStatus,
    },
];
