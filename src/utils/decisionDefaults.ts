import { DEFAULT_LAYERS_PLACED } from '../data/reinsuranceTower';
import { NO_NEW_BUSINESS } from './newBusinessAppetite';
// Single source of truth for default decisions. Used by the App (new game /
// next year), the Decisions page (per-line reset), and the Stage 2.10 pre-game
// history simulation — so the "steadily managed before the player took over"
// pre-game years can never drift from the in-game defaults.
import { SLIDER_RANGES, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import type { CoverageLine, DecisionSet, LineDecisionSet } from '../types/simulation';

// Fresh object per call (allocation is nested, so lines must not share a reference).
export function defaultLineDecisionSet(line: CoverageLine): LineDecisionSet {
  return {
    fundingConfidenceLevel: SLIDER_RANGES.fundingConfidenceLevel.default,
    // Default TRUE for every line, and no longer inert on any of them: all
    // three now default to "fund exactly at expected loss", the same CONCEPT on
    // each, rather than a per-line percentage stop (WC at 60%, GL at 65% — two
    // numbers that meant two different, both wrong, things before their own
    // derived tables existed). Property was the last line for which this flag
    // did nothing; its derived table crosses at 52.8%, not 60%, so it now
    // carries the same meaning here as on WC and GL.
    fundingAtExpected: true,
    // Renew everyone. A pool that declines by default would be making an
    // underwriting decision nobody took.
    renewalThreshold: null,
    /**
     * ⚠ WRITE NOBODY. AND THIS IS THE OPPOSITE RULING FROM renewalThreshold
     * DIRECTLY ABOVE, WHICH IS WHY IT IS ARGUED RATHER THAN JUST SET.
     *
     * Declining an EXISTING member by default would be an underwriting decision
     * nobody took — the pool would be throwing members out on its own
     * initiative. Writing a NEW member by default is the same kind of thing in
     * the other direction: the pool would be growing itself while the player
     * watched, and every consequence of that growth — the rate falling as fixed
     * costs spread, the reserve building, the book drifting away from the one
     * the game opened with — would arrive unattributed.
     *
     * The asymmetry is that renewal's default keeps the book AS IT IS and
     * appetite's default now does too. Both defaults are "change nothing". They
     * only look opposite because one control acts by omission and the other by
     * commission.
     *
     * ⚠ WITH BOTH AT THEIR DEFAULTS THE BOOK IS FROZEN FOR THE WHOLE GAME, and
     * that is the intended reading rather than a side effect. Voluntary
     * departures are off (VOLUNTARY_DEPARTURES_ENABLED), Renew All declines
     * nobody, and No New Business writes nobody — so a player who touches
     * nothing plays the pool they were given. Every membership change in a
     * played game is now traceable to a decision somebody made.
     *
     * ⚠ AND IT DOES NOT REACH THE PRE-GAME, WHICH IS WHAT MAKES IT SAFE TO SET.
     * The pre-game runs at these same defaults, so before the roster was frozen
     * STRUCTURALLY this would have changed the opening book — exactly the
     * coupling LineYearContext.freezeMembership removes. Verified rather than
     * assumed: the year-1 book is unchanged member for member across this
     * change.
     */
    newBusinessAppetite: NO_NEW_BUSINESS,
    dividendPct: SLIDER_RANGES.dividendPct.default,
    assessmentPct: SLIDER_RANGES.assessmentPct.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    // Default: every purchasable occurrence layer placed, no aggregate. Matches
    // the default-on-load rule for saves that predate the tower. KEYED BY
    // LINE — Property's one-layer tower must not receive WC's three-element
    // array (or vice versa); see DEFAULT_LAYERS_PLACED's own header.
    layersPlaced: [...DEFAULT_LAYERS_PLACED[line]],
    aggregateStopLevel: -1,
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    loanRepaymentAggressiveness: 0.5,
  };
}

export function defaultDecisionSet(yearNumber: number): DecisionSet {
  return {
    yearNumber,
    byLine: {
      WC: defaultLineDecisionSet('WC'),
      GL: defaultLineDecisionSet('GL'),
      Property: defaultLineDecisionSet('Property'),
    },
    // Pool-wide decisions (projected into every line at processYear entry).
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    // ⚠ NO PROGRAM IS COMMITTED BY DEFAULT, AND THAT IS WHY THE BASELINES DO NOT
    // MOVE. An opt-in program that changed the default game would be an uncaused
    // change to every figure in the pool. The pre-game runs at these defaults
    // too, so the opening book is untouched by the program's existence.
    riskControlProgramIds: [],
  };
}
