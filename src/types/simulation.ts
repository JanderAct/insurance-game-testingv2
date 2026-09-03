import type { WcRatingGroup } from '../data/defaultAssumptions';
// TYPE-ONLY, so the cycle with defaultAssumptions.ts (which imports Region from
// here) is erased at compile time and never exists at runtime.

// Core TypeScript types for Risk Pool Simulation v1

// Type-only, and circular with shocks.ts (which imports CoverageLine and Region
// from here). Erased at compile time, so the cycle never reaches the bundle.
import type { ScheduledShock, ShockRecord } from './shocks';

export type MemberStatus = 'active' | 'withdrawn' | 'prospect';
export type MemberType =
  | 'City'
  | 'County'
  | 'Fire District'
  | 'Water District'
  | 'Transit Authority'
  | 'School District'
  | 'Park District'
  | 'Recreation District'
  | 'Special District';

export type SizeCategory = 'Small' | 'Medium' | 'Large' | 'Very Large';

// Geographic region, an authored canonical-roster column since v2 (replacing a
// synthetic 1-5 draw). Three regions, assigned 72 / 61 / 67 across the roster.
export type Region = 'North' | 'Central' | 'South';

export interface Member {
  id: string;
  name: string;
  type: MemberType;
  sizeCategory: SizeCategory;
  // Geographic region — an authored column of the canonical roster (v2), never
  // re-rolled per game seed. Feeds WC's regional severity multiplier and is
  // scaffolding for future regional loss correlation (catastrophes striking a
  // region), which is what Property's generator will want.
  region: Region;
  // Property's location schedule, both authored roster columns since v3.
  // `locations` is the integer count of insured sites and is the attritional
  // frequency base (1,866 pool-wide) — a physical fact about the member, NOT
  // derived from insured value. `primaryAssetShare` is the fraction of the
  // member's TIV sitting in its DESIGNATED PRIMARY ASSET — which is not
  // necessarily its largest: for 9 v3 members the nominal primary is the
  // smaller site. Together they chop member TIV into per-location values,
  // which is what caps each claim's severity and keeps the per-risk
  // reinsurance layer alive (it fires on within-member concentration, not on
  // member-level TIV skew).
  locations: number;
  primaryAssetShare: number;
  exposureByLine: Partial<Record<CoverageLine, number>>; // exposure units, per coverage line
  // LOSSY display convenience, NOT an enrollment record. Opening enrollees are
  // stamped yearJoined: 1 ("was here when the game started" — the display
  // convention the members table wants) even though they actually enrolled at
  // the start of the pre-game (ledger startYear: -2). Consequently at Y1 a
  // genuine Y1 recruit and an opening member both read yearJoined: 1 and are
  // indistinguishable by this scalar alone — only PoolState.membershipHistory
  // can separate them. Do NOT "repair" this field to the true year (it would
  // surface pre-game internals in the UI) and do NOT answer per-line/per-year
  // enrollment questions from it — use the ledger.
  yearJoined: number; // yearNumber when joined
  calendarYearJoined: number;
  riskQuality: number; // 1-10
  satisfaction: number; // 1-10
  status: MemberStatus;
  yearWithdrawn?: number;
  // WC rating group — a STORED attribute, assigned in memberCatalog.ts.
  //
  // ⚠ DELIBERATELY STORED WHERE THE RETIRED WC_CLASS_MIX/GL_RELATIVITIES
  // LOOKUP TABLES WERE NOT. Both were exact functions of `type` (and both
  // retired with the GL severity rebuild — see CALIBRATION_FINDINGS), so
  // storing a type-derived value per member was duplication. This one
  // CANNOT be derived from `type` alone: the old WC_CLASS_MIX gave every city
  // a safety share of exactly 0.3500, so no threshold over it could separate
  // the eight cities that run their own police and fire departments from the
  // other 24. That is genuinely extra information — see
  // WC_HIGH_SAFETY_CITIES in defaultAssumptions.ts.
  //
  // Optional only so that saves written before the WC severity rebuild still
  // parse; App.tsx repairs it on load. wcClaimEngine THROWS on a member without
  // one rather than defaulting, because a silent default would generate no
  // claims and read as calibration drift months later.
  wcRatingGroup?: WcRatingGroup;
}

export interface MemberLossResult {
  memberId: string;
  memberName: string;
  exposure: number; // exposure units for the line this loss was simulated on
  riskQuality: number;
  expectedLoss: number;
  coefficientOfVariation: number;
  standardDeviation: number;
  simulatedLoss: number;
}

// ---------------------------------------------------------------------------
// Claim / Occurrence scaffolding for the loss-distribution work.
//
// TYPE SCAFFOLDING ONLY: nothing constructs, stores, or consumes these yet —
// no generation logic, no processLineYear wiring, no reinsuranceEngine
// involvement. They exist so the claim-level loss generator being designed
// against the WC/GL distribution spec has a settled data shape to target.
// ---------------------------------------------------------------------------

// One loss event. Groups the claims it causes (WC and GL both emit 1:1 —
// GL's multi-claimant abuse batches were deleted with the sub-coverage
// rebuild; Property's weather/cat events are the multi-claim case now), and
// is the unit the $1M retention waterfall nets against: the retention
// applies to the OCCURRENCE total, i.e. the sum over claimIds.
export interface Occurrence {
  id: string;
  line: CoverageLine;
  // WHO THE EVENT HIT. memberIds is the authoritative list and is ALWAYS
  // populated (length >= 1). memberId is a single-member convenience field,
  // present only when the event hit exactly one member.
  //
  // DO NOT "SIMPLIFY" memberId BACK TO A REQUIRED string. Its optionality is
  // load-bearing, not stylistic. tsconfig sets strict: true, so memberId reads
  // as `string | undefined` and the COMPILER forces every consumer to handle
  // the multi-member case explicitly rather than silently attributing a
  // pool-wide event to one member. Weather is the only genuinely multi-member
  // occurrence now that GL's multi-claimant abuse batches are gone.
  memberId?: string;
  memberIds: string[];
  accidentYear: number;   // yearNumber the event happened (pre-game years negative)
  calendarYear: number;
  // For a single-member event, that member's region. For a multi-member
  // hazard event, the ZONE the event struck — the correlation unit itself,
  // not a property of any one member.
  region: Region;
  isCatastrophe: boolean; // part of a regional/pool-wide catastrophe event
  claimIds: string[];     // every claim this event produced (WC and GL: exactly one)
  // The hazard band this event belongs to, for lines that have more than one:
  // Property emits 'attritional' | 'weather' | 'cat'. Absent on WC and GL,
  // which have a single hazard band each — their sub-coverage vocabulary lives
  // on Claim.tier and is a rating class, not a peril. Deliberately a string,
  // for the same reason Claim.tier is.
  peril?: string;
  // The event's realized hazard intensity, where the band draws one (weather,
  // cat). Unitless and band-specific: it is the driver that scales BOTH the
  // event's footprint and its damage severity, so it is recorded to make that
  // shared dependence externally checkable. Absent where no such draw exists.
  intensity?: number;
}

export type ClaimStatus = 'open' | 'closed' | 'reopened';

// One claim within an occurrence.
export interface Claim {
  id: string;
  occurrenceId: string;
  memberId: string;
  line: CoverageLine;
  accidentYear: number;   // yearNumber (pre-game years negative)
  calendarYear: number;
  // Severity class the claim falls under: a MIXTURE COMPONENT for both WC
  // (small / medium / large / schoolsMedium, or 'injected' for a shock claim)
  // and GL (component1 / component2 / component3), a peril label for
  // Property. Deliberately a string, not a union — the vocabularies belong to
  // the distribution work.
  //
  // GL's values CHANGED with the sub-coverage rebuild: they used to be a
  // GL_RELATIVITIES sub-line (general / epl / lawEnforcement / abuse), one
  // flat mixture replaced all four. Anything that pattern-matches the old GL
  // sub-coverage strings needs revisiting, not just recompiling.
  tier: string;
  // The rating GROUP the claim arose from (WC: county / schools / highSafety /
  // lowSafety). Was a rating CLASS before the severity rebuild.
  ratingClass?: string;
  status: ClaimStatus;
  reportedYear: number;   // yearNumber the claim became known (>= accidentYear; supports IBNR vs case)
  grossUltimate: number;  // current estimate of the claim's full gross cost
  paidToDate: number;
  caseReserve: number;    // unpaid estimate on this claim (grossUltimate - paidToDate once reported)
  // Fractions of grossUltimate expected to be paid in years 1..n after the
  // accident year. Data for Phase 3 reserving — nothing consumes it yet.
  //
  // NO LONGER POPULATED BY WC. The retired tier model carried a payout pattern
  // per tier; the mixture model books one amount with no payout schedule, so
  // WC claims leave this absent. GL and Property are unaffected.
  paymentPattern?: number[];
}

// Seeded, read-only operating history shown before Year 1 begins.
export interface HistoricalYear {
  historyYearNumber: number;
  calendarYear: number;
  activeMembers: number;
  activeExposure: number;
  totalMarketExposure: number;
  marketShare: number;
  purePremiumPer100: number;
  poolPremiumRatePer100: number;
  expectedLoss: number;
  poolPremium: number;
  adminExpense: number;
  poolPremiumAndAdminExpense: number;
  reinsuranceCost: number;
  totalMemberCharge: number;
  grossUltimateLoss: number;
  reinsuranceRecovery: number; // reinsurer's paid share of ceded loss
  // Memo, same convention as above: what the tower absorbed of that year's
  // PRIOR-YEAR development, and nothing else. Optional — pre-game years written
  // before the mechanism existed carry no value and read as 0.
  priorYearDevelopmentCeded?: number;
  // Recovery DEFERRED by booking that year's register low. A current-year item;
  // it used to be folded into the line above and was mislabelled there.
  bookingGiveBack?: number;
  // Per-occurrence tower outputs. OPTIONAL HERE ONLY: the pre-game bootstrap
  // predates the tower decision, so seeded history carries no placement. The
  // LIVE result types require these.
  cededByLayer?: number[];
  retainedAboveTower?: number;
  aggregateRecovery?: number;
  aggregatePremium?: number;
  aggregateAttachment?: number;
  netUltimateLoss: number;
  netPaidLosses: number;
  endingNetReserve: number;
  actualLossRatio: number;                 // MEMBER-CHARGE basis
  // PRICING basis and RETAINED-PREMIUM basis, mirroring LineResultSet's.
  // OPTIONAL because a save written before this existed carries neither, and
  // the Dashboard's pre-game rows must keep rendering from an old save rather
  // than showing NaN. Consumers fall back to recomputing from the dollar fields
  // above, which are all present in every save.
  actualLossRatioPricingBasis?: number;
  actualLossRatioRetainedPremium?: number;
  actualExpenseRatio: number;
  actualCombinedRatio: number;
  underwritingIncome: number;
  investmentIncome: number;
  netIncome: number;
  endingSurplus: number;
  requiredReserveMargin: number;
  excessCapitalRatio: number | null;
  capitalAdequacyStatus: string;
}

// Game instance environment — seeded, immutable after creation
export interface GameInstance {
  instanceId: string;
  seed: number;
  lossEnvironment: {
    baseLossRatio: number;        // e.g. 0.68
    lossTrend: number;            // annual claim inflation e.g. 0.04
    volatility: number;           // std dev factor e.g. 0.15
    shockProbability: number;     // e.g. 0.08
    shockSeverityMultiplier: number; // e.g. 2.5
    heavyTailRisk: number;        // 0-1 extra tail probability
  };
  investmentEnvironment: {
    baseReturn: number;           // e.g. 0.04
    volatility: number;           // e.g. 0.06
    downsideRisk: number;         // probability of negative year e.g. 0.10
  };
  marketEnvironment: {
    totalMarketGrowthRate: number; // e.g. 0.02
    competitivePressure: number;   // 0-1
    memberSensitivity: number;     // 0-1 how reactive members are to price
  };
  // Shock events scheduled for this game, by catalog id and fire year. See
  // src/data/shockCatalog.ts.
  //
  // OPTIONAL AND ABSENT BY DEFAULT, AND THAT IS LOAD-BEARING. generateGameInstance
  // does NOT draw to populate this and does not write the field at all unless a
  // scenario supplies one, so a game with no shocks is byte-identical to one
  // from before shocks existed. Probability-based firing, when it is added,
  // populates this same list from its own purpose-keyed RNG label; everything
  // downstream is unchanged by that.
  scheduledShocks?: ScheduledShock[];
}

// Coverage lines a pool can write. Selected once at game setup and locked for
// the whole game. (Stage 1.1: type + setup selection only — not yet consumed by
// the simulation engine.)
export type CoverageLine = 'WC' | 'GL' | 'Property';

export interface GameSetupSettings {
  poolName: string;
  gameLength: number;     // number of years
  startingYear: number;   // calendar year label only
  instanceId: string;
  activeLines: CoverageLine[];  // coverage lines the pool writes (at least one)
}

// Per-line player decisions for a given year.
// riskControlPct and assetAllocation are POOL-WIDE decisions (set once on
// DecisionSet below); the copies here are projected from the pool values at
// processYear entry so the engine and each line's locked result snapshot keep
// their existing per-line shape. The UI edits only the DecisionSet-level pair.
export interface LineDecisionSet {
  // rateChange REMOVED — CLF-only pricing. Funding confidence is now the sole
  // pricing lever (see SLIDER_RANGES.fundingConfidenceLevel and the funding
  // consequence panel on DecisionsPage). Three read sites removed it
  // deliberately, each commented: membershipEngine.ts's updateSatisfaction,
  // calcRetentionProbability and calcExpectedNewMembers.
  fundingConfidenceLevel: number; // 0.30 to 0.95
  // "EXPECTED" IS A MODE, NOT A NUMBER. WC's and GL's derived grids are
  // percentile curves, so break-even (CLF exactly 1.000) falls BETWEEN
  // percentile stops and moves with the enrolled book's own CV/lambda — WC
  // from ~56.5% (full roster) to ~67.0% (smallest book), GL from ~60.8% to
  // ~75.2%. It cannot be represented as a fixed number in
  // fundingConfidenceLevel: that field would go stale the moment the book's
  // composition shifted, silently drifting off CLF 1.000 while still reading
  // as "the chosen value". ALL THREE LINES: true means the engine bypasses the
  // table stop-lookup entirely and uses CLF = 1.000 exactly, at every book
  // size, every year — not an interpolated value that happens to land close.
  //
  // ⚠ PROPERTY USED TO IGNORE THIS FIELD and no longer does. It read the
  // generic FUNDING_CLF_TABLE, whose 60% entry is exactly 1.000, so its
  // "Expected" and its 60% stop coincided and the flag was inert. Its own
  // derived table crosses at 54.0%, so the two no longer coincide and the flag
  // is what keeps "Expected" meaning break-even rather than a 60% stop.
  // fundingConfidenceLevel is NOT read for pricing while this is true (it is
  // only the fallback the slider lands on if the player later drags away from
  // Expected to a specific percentile stop).
  fundingAtExpected: boolean;
  dividendPct: number;            // 0.00 to 0.15 of premium
  assessmentPct: number;          // 0.00 to 0.25 of premium
  underwritingStrictness: number; // 0-10
  riskControlPct: number;         // 0.00 to 0.08 of premium (projected from DecisionSet.riskControlPct)
  // Per-occurrence tower placement, index-aligned to REINSURANCE_TOWER[line].
  // false = that band is RETAINED. ANY COMBINATION IS PERMITTED, including a
  // corridor retention (buying $15M xs $10M while declining $5M xs $5M) — that
  // is unusual in the market but real, and choosing which bands to keep is the
  // point of the decision. Property's tower is one layer, so its only choice
  // is buy it or retain it — no corridor is possible with a single band.
  layersPlaced: boolean[];
  // AGGREGATE STOP-LOSS on total annual retained loss: index into
  // AGG_ATTACHMENT_LEVELS[line], or -1 for not purchased. WC AND PROPERTY
  // ONLY — GL is occurrence-only (market capacity, and the pricing model's
  // lognormal fit is not valid at GL's retained-loss CV; see
  // reinsuranceTower.ts). Property's aggregate is priced by Panjer recursion
  // rather than WC's lognormal fit — see propertyAggregate.ts.
  aggregateStopLevel: number;
  assetAllocation: AssetAllocation;    // projected from DecisionSet.assetAllocation
  loanRepaymentAggressiveness: number; // 0.00 to 1.00 — share of positive net income used to
                                       // repay an outstanding inter-line loan first; only
                                       // relevant while that line carries a loan balance
}

// An inter-line loan from specific lending lines to a single line whose surplus
// went negative. Tracked at the pool level (see PoolState.interLineLoans). At
// most one outstanding loan per borrowing line at a time. Stage 2.9: the money
// is a real transfer out of the lending lines' invested assets; repayments
// (principal + interest) flow back to the same lenders in the same fixed shares.
export interface InterLineLoan {
  borrowingLine: CoverageLine;
  principal: number;              // original amount borrowed (the deficit that was covered)
  remainingBalance: number;       // outstanding principal + accrued interest, reduced by repayments
  currentRate: number;            // the pool's asset-weighted blended investment return, RE-BLENDED
                                  // every year this loan is outstanding (not fixed at origination —
                                  // it tracks the lenders' current opportunity cost), floored at 0 so
                                  // a bad market year can charge no interest but never pay the
                                  // borrower. Named rateAtOrigination before it was made to float;
                                  // renamed so the field doesn't lie about what it holds.
  yearOriginated: number;
  lenderShares: Partial<Record<CoverageLine, number>>; // each lending line's share of the loan
                                                       // (sums to 1), fixed at origination
}

// Investment portfolio allocation across cash/bonds/equities — must sum to
// 100. The ALLOCATION DECISION is pool-wide (one policy for every line), but
// portfolios stay segregated per line (Stage 2.9): each line applies this
// shared allocation to its own invested assets against the shared market draw.
export interface AssetAllocation {
  cashPct: number;
  bondsPct: number;
  equitiesPct: number;
}

// Player decisions for a given year: one LineDecisionSet per line, plus the
// two POOL-WIDE decisions — investment allocation and risk-control intensity.
// Pool-wide means one policy value; each line still applies it to its OWN
// base (own invested assets / own premium), so effects stay line-sized.
export interface DecisionSet {
  yearNumber: number;
  byLine: Record<CoverageLine, LineDecisionSet>;
  assetAllocation: AssetAllocation;  // pool-wide investment policy
  riskControlPct: number;            // pool-wide risk-control intensity (0.00-0.08 of each line's own premium)
}

// ONE OCCURRENCE CARRYING AN ACCIDENT YEAR'S DEVELOPMENT.
//
// The subset is drawn at inception (see developmentAllocation.ts) and is
// RESELECTED ONCE PER VALUATION AS CLAIMS CLOSE: a claim that has closed stops
// carrying development and an open one takes its place. Between closures the
// set does not move, so the same claims keep deteriorating rather than a fresh
// subset appearing each valuation — which is both how a real book reads and
// what makes "which claims developed" a coherent story in the register.
//
// ⚠ THE SET WAS FROZEN FOR ITS WHOLE LIFE UNTIL THE CLOSURE CURVES LANDED, and
// what "frozen" was protecting was NOT that the set is fixed. It was that the
// set cannot be REARRANGED — between the two directions of a valuation, or
// between one valuation and the next for a reason other than closure. A set
// that is reselected on closure alone, once, and then used for both directions
// keeps every bit of that protection. See developmentAllocation.ts's
// RESELECTION block and the three invariants development-cession-check now
// asserts in place of the frozen-subset one.
//
// ⚠ ONLY THE SUBSET IS STORED, NOT THE WHOLE REGISTER, and that is what keeps
// this inside Ruling 8's storage budget. Cession is per occurrence and
// independent between occurrences, so the marginal cession of a development
// depends ONLY on the occurrences that moved — the other ~500 in the accident
// year cede exactly what they always did and do not need to be carried. Three
// records per cohort rather than five hundred.
export interface DevelopingClaim {
  claimId: string;
  occurrenceId: string;
  /** As the generator drew it, GROSS of reinsurance. Never moves. */
  drawn: number;
  /** As first BOOKED — `drawn` less this cohort's optimistic markdown. Equal to
   *  `drawn` when the line was funded at or above break-even. Never moves. */
  original: number;
  /** The occurrence total now, after every movement to date. GROSS. */
  current: number;
  /** True if this occurrence is currently in the developing subset. Both
   *  directions of the stochastic step go to it — the name predates symmetric
   *  routing and is kept because it is the word every gate and comment uses.
   *
   *  ⚠ THIS IS REDRAWN EVERY VALUATION. Cleared for every occurrence and then
   *  set on whichever are drawn, so an open occurrence may develop one year and
   *  not the next. What it never does is change between the two DIRECTIONS of a
   *  single valuation — that is the free-lunch guard, and it is
   *  within-valuation. */
  developing: boolean;
  /** True once this occurrence's claim has closed, as at the last valuation
   *  that reselected. Closure is a pure function of (gameId, claimId, curve,
   *  age) — see claimClosure.ts — so this is a CACHE of a derived fact, carried
   *  so the register can be read without re-deriving it, never a source of
   *  truth. Monotone: a closed occurrence never reopens.
   *
   *  ⚠ A CLOSED OCCURRENCE STILL TAKES THE PROPORTIONAL UNWIND, and that is
   *  deliberate — see processIbner. It takes no development draw. */
  closed?: boolean;
  /** THIS OCCURRENCE'S MOVEMENT AT EACH VALUATION, oldest first. Index k is the
   *  step taken from age k to age k+1, so it belongs to valuation year
   *  `yearNumber + k + 1` of the cohort that holds it. The two movements a step
   *  makes — the stochastic draw and the deterministic unwind — are summed into
   *  ONE entry, because a valuation produces one revised estimate and the split
   *  between them is a mechanism detail, not something a valuation reports.
   *
   *  ⚠ THE MARKDOWN IS NOT IN HERE. `drawn -> original` happens at inception, not
   *  at a valuation, and is readable as the difference between those two fields.
   *  Putting it in the series would make the first entry a booking decision
   *  wearing a valuation's clothes.
   *
   *  ⚠ WHY THIS IS STORED RATHER THAN DERIVED. The same reason
   *  ReserveDevelopmentRow exists: each step multiplies by a fresh lognormal draw
   *  and then SPLITS it across occurrences by their then-current values, so
   *  yesterday's value cannot be recovered from today's — neither the draw nor
   *  the split survives. `current - original` is the only thing a derivation can
   *  reach, and it nets a claim that doubled then halved to nothing.
   *
   *  ⚠ AND IT IS BOUNDED, which is what keeps it inside Ruling 8. Length is
   *  capped by the cohort's horizon, not by game length: at most 12 entries (WC's
   *  IBNER_HORIZON.max), 8 on GL, 4 on Property. It does NOT grow as the game runs
   *  on — a year-30 save carries the same per-claim series a year-12 save does.
   *  Measured over 3 games x 10 years x 3 lines in both funding arms
   *  (scripts/diagnostics/claims-workbook-check.ts): 12.7-13.5 KB of a 389 KB
   *  serialised poolState, 3.3-3.5% of it and ~0.27% of a 5MB quota. */
  movementByStep?: number[];
}

// ============================================================================
// A REPLACEMENT WAITING TO BE CALLED ON — an occurrence drawn size-weighted at
// inception, sitting inside `untrackedTotal` until a developing claim closes.
//
// ⚠ IT IS NOT TRACKED AND IT CEDES NOTHING WHILE IT SITS HERE. That is the
// whole point of keeping it in a separate array rather than in
// `developingClaims` with developing: false. A benched occurrence is below the
// retention by construction, and its dollars are still counted inside
// `untrackedTotal`; promoting it into the tracked set moves the same dollars
// from the scalar into the list and nothing else. If it were tracked from
// inception it would begin to cede the moment the proportional unwind pushed
// it over the retention — while an identical occurrence that happened not to be
// drawn would not. Being on a storage shortlist is not a reason to cede.
//
// ⚠ `current` MIRRORS THE UNTRACKED MASS AND IS NOT INDEPENDENT STATE. The
// untracked total only ever moves multiplicatively — every allocation path
// gives it a share proportional to what it holds — so each benched occurrence's
// value is its booked value scaled by the same factor the mass moved by.
// processIbner applies that factor each valuation. It is carried rather than
// recomputed because promotion removes dollars from the mass, which breaks the
// single-ratio shortcut the moment it happens.
// ============================================================================
export interface BenchClaim {
  claimId: string;
  occurrenceId: string;
  /** As the generator drew it, GROSS. Never moves. Also the size the closure
   *  curve is resolved on, exactly as for a tracked occurrence. */
  drawn: number;
  /** As first BOOKED — `drawn` less this cohort's optimistic markdown. */
  original: number;
  /** Its share of the untracked mass now. Becomes the occurrence's `current` on
   *  promotion, so no dollars are created or lost by promoting. */
  current: number;
}

// Annual reserve cohort for simplified development. NET basis: losses enter
// net of reinsurance recoveries (recovery cash arrives in lockstep with the
// claim payments it offsets, so there is no separate recoverable receivable).
// A claim DRAWN but NOT YET REPORTED — the IBNR inventory.
//
// ⚠ THIS IS PERSISTED TO localStorage, AND THAT IS AN EXCEPTION TO RULING 8
// WITH A REASON, not an oversight. Ruling 8 keeps `ResultSet.claims` out of
// storage because the claim log is an UNBOUNDED FLOW: ~1,800 claims/yr reaches
// ~7MB by year 10 and blows the quota. This inventory is a BOUNDED STOCK — at
// ~151 delayed claims/yr full-market and a ~3.5-year mean lag it holds ~530
// records and stops growing, because 78%+ clear within four years. At ~150
// bytes a record that is ~80KB, about 1.6% of a 5MB quota.
//
// AND IT CANNOT BE REGENERATED. Every draw is a pure function of
// (seed, member, year), so replaying year 3 in year 9 is architecturally
// available. Three reasons not to, the third decisive:
//   1. O(years^2) work.
//   2. It would have to replay that year's exact kLine, enrolment and
//      risk-control inputs.
//   3. A RETROACTIVE SHOCK CHANGES PARAMETERS, so replaying a prior year under
//      current parameters would silently restate history. The pinned original
//      draw is precisely what gives a retroactive shock its force.
//
// Fields are exactly what re-emitting the claim needs, and no more.
export interface ReserveCohort {
  yearNumber: number;
  calendarYear: number;
  // The cohort's CURRENT estimate of ultimate, net of reinsurance. This is what
  // develops: IBNER moves it each year until the cohort matures. `netUnpaid`
  // follows from it, and `netPaid` accumulates against it.
  netUltimate: number;
  netPaid: number;
  netUnpaid: number;

  // --- THE GROSS PAID LEDGER (see processIbner's gross block) --------------
  // ⚠ A PARALLEL LEDGER THAT NEVER FEEDS THE NET ENGINE, and that is the design
  // rather than an implementation detail. These run alongside netPaid/netUnpaid
  // at the SAME conditionalPaydown rate and absorb the SAME development, but
  // nothing in the net path ever reads them. That is what keeps the null test
  // available: every pre-existing field stays bit-identical, so value-identity
  // can still tell an engine change from a recording.
  //
  // GROSS, because the claims are gross. Tying a gross per-claim column to a NET
  // cohort figure would thread the cession split through every row; one basis end
  // to end makes the tie-out arithmetic instead of a reconciliation.
  //
  // Optional only for cohorts deserialised from a save written before this
  // existed; every cohort the engine creates carries both.
  grossPaid?: number;
  grossUnpaid?: number;
  // ⚠ `paydownPct` IS GONE. It stored a per-cohort copy of a line-level
  // constant, which was harmless while that constant was flat and a second
  // description of one fact the moment payout patterns replaced it. The rate is
  // now looked up from the line's pattern at the cohort's own age — see
  // payoutPattern.ts — so `age` and the line are the whole state it needs.
  closed: boolean;

  // --- IBNER (see defaultAssumptions.ts's IBNER_* block) -------------------
  // ⚠ `developmentFactor` IS GONE. It was written at two sites and READ AT
  // NONE — processReserveDevelopment drew its own factor fresh and ignored the
  // stored one — while still spending an RNG draw to fill it. The fields below
  // replace it with state that is actually consulted.

  // Sum of the claims the generator drew for this accident year, NET of
  // reinsurance, frozen at inception. The claim register keeps showing exactly
  // this; it never develops. `netUltimate - registerSum` IS the IBNER provision.
  registerSum: number;
  // Runoff length in years, drawn per cohort. The cohort stops developing once
  // it has taken this many steps.
  horizon: number;
  // Steps taken so far. Development stops at `age >= horizon`.
  age: number;
  // This cohort's draw from IBNER_STEP_MIXTURE — its "boring or eventful"
  // character, fixed for the cohort's whole life.
  stepMultiplier: number;
  // The optimistic booking bias applied at inception, as a fraction. Unwinds at
  // bias/horizon per year so E[netUltimate at maturity] = registerSum exactly.
  // Zero whenever the line was funded at or above break-even.
  bookingBias: number;

  // --- claim-level development (see developmentAllocation.ts) --------------
  // The occurrences this accident year's development lands on. EMPTY on a seed
  // cohort, which has no claim register behind it — its development is retained
  // entire, which is the honest default and is 0.4% of all adverse development.
  // ⚠ TRACKED OCCURRENCES, NOT JUST THE CARRIERS. Everything at or above the
  // retention plus the developing set — the only occurrences whose value can ever
  // change a cession. EMPTY on a seed cohort, which has no register behind it
  // and retains its development entire.
  developingClaims?: DevelopingClaim[];
  // Gross total of the occurrences NOT tracked. All below the retention, so
  // they never cede; carried so a proportional movement gets the shares right
  // without storing five hundred numbers per cohort.
  untrackedTotal?: number;
  // ⚠ THE REPLACEMENTS, DRAWN AT INCEPTION AND HELD UNTIL NEEDED. Reselection
  // has to draw a replacement SIZE-WEIGHTED from the open register, and
  // by valuation time the register is gone — everything not tracked has
  // collapsed into the one scalar above, and there is no list left to draw from.
  // So the draw happens at inception, when the register still exists, and its
  // result waits here. See developmentAllocation.ts's RESELECTION block for why
  // a bench and not a rule over the tracked set, and what it costs.
  //
  // Dropped the moment the cohort matures, because nothing reselects after
  // that. Bounded by construction: only cohorts still inside their horizon
  // carry one, so at most 12 WC + 8 GL + 4 Property cohorts hold a bench at any
  // valuation however long the game runs.
  developmentBench?: BenchClaim[];
  // ⚠ CUMULATIVE DEVELOPMENT THE TOWER HAS TAKEN OFF THIS COHORT, and it RESTATES
  // A STANDING IDENTITY. ibner-null-check asserted that a matured cohort's
  // netUltimate equals registerSum exactly — the statement that the optimistic
  // booking unwinds in full. That is no longer true and should not be: the
  // unwind lands on claims like any other adverse movement, so a claim above the
  // retention cedes part of it and the pool's NET ultimate ends BELOW its
  // register sum by exactly what the reinsurer took. The identity becomes
  //
  //     netUltimate + cededDevelopmentToDate === registerSum   (at maturity)
  //
  // and it is still exact. Ceding development is precisely the pool ending up
  // better off than its own register; an invariant saying otherwise was an
  // invariant about the old mechanism.
  cededDevelopmentToDate?: number;
  // ⚠ THE LAYERS IN FORCE IN THE ACCIDENT YEAR, NOT THE VALUATION YEAR.
  // Occurrence cover attaches to the accident year, so a development arriving
  // in year 7 on accident year 3 is covered by what year 3 bought. Storing it
  // on the cohort is what makes that true without having to look up a decision
  // set that may no longer exist.
  placedAtInception?: boolean[];
}

// ONE ACCIDENT YEAR'S ESTIMATE, AT EVERY VALUATION IT HAS SEEN — the reserve
// development exhibit's only source.
//
// ⚠ THIS EXISTS BECAUSE THE PATH IS NOT RECONSTRUCTIBLE, and that is worth
// stating plainly before anyone tries to delete it as redundant with
// ReserveCohort. A cohort stores its CURRENT estimate and nothing else. Each
// development step multiplies the remaining reserve by a fresh lognormal draw
// (processIbner), so yesterday's estimate cannot be recovered from today's by
// dividing anything out: the draw is gone. And a cohort is filtered out of
// `reserveCohorts` the year after it closes, so even its final estimate stops
// being readable. A development triangle needs both. Hence an append-only
// ledger that no engine arithmetic reads.
//
// ⚠ NOTHING IN THE ENGINE CONSUMES THIS. It is written by processLineYear and
// read only by the Actuarial memorandum. Adding it moved no value and spent no
// RNG draw, which is the property that let a display feature ship against
// unchanged gates. Keep it that way: if a priced or booked quantity ever starts
// reading this ledger, the ledger has become engine state and needs the
// scrutiny that goes with it.
export interface ReserveDevelopmentRow {
  yearNumber: number;          // the ACCIDENT year this row describes
  calendarYear: number;
  // The cohort's estimate of ULTIMATE as at the end of each successive
  // valuation year, oldest first. Index k is valuation year
  // firstValuationYear + k. Ultimate, not reported/incurred: the exhibit is
  // about the gap between what is reported and what is estimated, so the
  // ambiguous word is wrong exactly where the distinction is the point.
  ultimateByValuation: number[];
  // CUMULATIVE NET PAID at each of the same valuations, same indexing. A
  // RECORDING, not a computation — the figure processIbner already produced,
  // written down so a paid triangle and a paid-to-incurred ratio exist without
  // anything having to reconstruct them.
  //
  // ⚠ NET, MATCHING ultimateByValuation BESIDE IT, AND THE GROSS SERIES WAS
  // MEASURED AND REJECTED. The paid ledger the engine runs is GROSS — that is
  // what the claims workbook needs and what ReserveCohort.grossPaid carries —
  // so the obvious thing was to record the gross series here too and give the
  // exhibit a gross paid-to-incurred. It was built that way and it cost a SECOND
  // array, because a gross ratio also needs a gross denominator per valuation.
  // Two arrays took cohort-stock-check's poolState growth ratio from 0.65 to
  // 0.76 against its 0.75 limit: real accumulation on a ledger that already
  // grows a number per accident year per valuation forever. One array passes at
  // 0.72.
  //
  // Given one, NET is the right one. The exhibit's other five columns are net,
  // so a net paid column and a net paid-to-incurred make that document
  // internally consistent and subtractable throughout — where a gross paid
  // column sitting beside a net ultimate is precisely the mixed-basis reading
  // this project keeps producing. The CLAIMS WORKBOOK stays gross end to end and
  // reads ReserveCohort.grossPaid directly, so each document is coherent on its
  // own basis. The two do not tie across documents and are not meant to; the
  // difference is what the tower is carrying.
  //
  // Absent on rows written before the ledger existed, and on nothing else.
  paidByValuation?: number[];
  // The valuation year that ultimateByValuation[0] belongs to.
  firstValuationYear: number;
  // The cohort's age at that first valuation. Zero for an accident year the
  // engine wrote; POSITIVE for a seed cohort, which is born already aged.
  ageAtFirstValuation: number;
  // Runoff length. Development stops once age exceeds it.
  horizon: number;
  // ⚠ SEEDED COHORTS HAVE NO REGISTER BEHIND THEM. They are apportioned from a
  // drawn reserve total rather than summed from claims, so their first entry is
  // their estimate AS AT GAME START, not at inception — there was no inception.
  // The exhibit labels their column differently for that reason; presenting a
  // game-start value as an original estimate would be the fiction that
  // generateStartingReserveCohorts' header refuses to invent.
  seeded: boolean;
}

// Full result for one completed simulation year
export interface ResultSet {
  yearNumber: number;
  calendarYear: number;
  // WHICH LINE THIS ROW IS. Absent on the POOL row, which is an aggregate of all
  // of them.
  //
  // ⚠ ADDED BECAUSE A COUNT WAS BEING USED AS AN IDENTITY. resultMetrics inferred
  // the line from `cededByLayer.length >= 4 ? 'WC' : 'GL'`, which worked only
  // while WC's tower had four layers and GL's had three. Merging WC's top two
  // layers made both three, and that test would have silently labelled every WC
  // row 'GL' — compiling, rendering, and printing GL's layer names on a WC
  // result. A row carries its own identity now.
  //
  // A STRING, so value-identity-check (numeric fields only) is blind to it by
  // construction, and it is not a spreadsheet metric so no export hash moves.
  line?: CoverageLine;

  // Decisions echoed
  decisions: LineDecisionSet;
  assetAllocation: AssetAllocation; // this line's own allocation decision, echoed
                                    // (pool-level aggregate shows the first line's as a placeholder)

  // Membership
  //
  // ⚠ MEMBERS AND ENROLMENTS ARE DIFFERENT NUMBERS AT POOL SCOPE, and conflating
  // them is the defect class this block exists to prevent. A member carrying WC
  // and GL is ONE member and TWO enrolments. At LINE scope the two coincide, so
  // every field below is a plain headcount there and the distinction only bites
  // on the pooled row.
  //
  // These three are DISTINCT MEMBER counts at both scopes. They are what a
  // player means by "how many members do we have".
  activeMembers: number;
  newMembers: number;
  withdrawnMembers: number;
  // The enrolment sum — activeMembers summed across lines without deduplication.
  // Equal to activeMembers at line scope; ~47% higher at pool scope on a
  // three-line book. It is NOT a headcount and must never be displayed as one.
  //
  // It is carried because it is the legitimate WEIGHT behind memberSatisfaction
  // and averageRiskQuality: those average a per-line figure weighted by that
  // line's enrolments, and a member with two lines genuinely has two enrolment
  // experiences to average. Anyone reconstructing either figure from the export
  // needs this column; dividing by activeMembers instead would inflate both.
  enrolmentCount: number;
  // Ids of the members who joined / left this line this year. Carried so the
  // pooled row can count DISTINCT joiners and leavers rather than summing
  // per-line events — a member taking WC and GL in the same year is one joiner,
  // not two. Line scope: exactly `newMembers` / `withdrawnMembers` entries.
  //
  // ⚠ THESE EXIST BECAUSE `Member.yearJoined` CANNOT ANSWER THE QUESTION, and
  // its own comment says so: every opening member carries yearJoined 1, so
  // filtering the roster on it reports the entire year-1 book as joiners (140
  // against a true 41 when this was tried). The per-line sets are the only
  // record of who actually entered or left in a given year.
  newMemberIds: string[];
  withdrawnMemberIds: string[];
  activeExposure: number;
  totalMarketExposure: number;
  marketShare: number;          // exposure-based
  memberRetentionRate: number;
  memberSatisfaction: number;
  averageRiskQuality: number;
  memberList: Member[];

  // Pricing
  rateLevel: number;            // cumulative index
  ratePer100: number;           // rate per $100 payroll
  purePremiumPer100: number;    // expected loss per $100 payroll
  purePremium: number;          // kept for compat
  // NET-FUNDING INTERMEDIATES — purePremiumPer100 is GROSS; poolPremium funds
  // (purePremiumPer100 - expectedCededPer100) x CLF x rateLevel/100. Both were
  // locals inside processLineYear until now, so nothing outside the engine
  // could reproduce poolPremium, and the audit page's build-up card displayed
  // a gross derivation beside a net value it could not reconcile to (38-73%
  // apart on WC/GL). Added purely so that gap can be closed; see
  // simulationEngine.ts's fundedNetExpectedLoss and the net-funding note above
  // it for the fuller story.
  //
  // STORED UNROUNDED, unlike purePremiumPer100 above (which is toFixed(4) for
  // display) — these two exist to satisfy an exact identity
  // (poolPremium === activeExposure x netPurePremiumPer100 x CLF x
  // rateLevel/100 x 10_000), and rounding either would break that to display
  // precision instead of float precision.
  //
  // NOT COLLAPSIBLE TO ONE FIELD. netPurePremiumPer100 = Math.max(0,
  // purePremiumPer100 - expectedCededPer100) — a floor that has never bound in
  // measurement, but deriving one from the other via that formula would only
  // reproduce the un-rounded purePremiumPer100 exactly, and the only copy of
  // that on this type is rounded. Both are stored so the identity holds from
  // stored fields alone.
  //
  // ⚠ NONZERO ON EVERY LINE NOW. This said "ZERO ON PROPERTY, exactly and by
  // construction" until Property got its own occurrence layer and aggregate;
  // netting follows from `hasTractableCeded`, so widening that widened this with it.
  // Property's expectedCededPer100 is a measured quantity like WC's and GL's
  // (~25% of gross pure premium at the default placement) and only reaches 0
  // if the player declines the layer AND the aggregate.
  expectedCededPer100: number;
  netPurePremiumPer100: number;
  writtenExposure: number;      // payroll exposure in $M

  // Premium
  poolPremium: number;                     // expected loss at selected CLF
  adminExpense: number;                    // payroll-based administrative charge
  poolPremiumAndAdminExpense: number;      // expected-ratio denominator
  totalMemberCharge: number;               // includes separately stated reinsurance cost
  grossPremium: number;
  assessments: number;
  dividends: number;

  // Losses
  // The roster/risk-quality-mix correction ACTUALLY APPLIED to this line's draw
  // this year — k_line for WC, k_GL for GL. Absent on the aggregate (Property)
  // path, which has no such correction.
  //
  // EXPOSED SO THE ENROLLED-BOOK RULE CAN BE ASSERTED RATHER THAN REVIEWED. It
  // must equal computeKLine/computeKGl of the ENROLLED book. Marketplace-wide
  // generation makes it easy to pass the 200-member roster here by accident,
  // which would drive the correction to ~1 and silently disable it — and on the
  // canonical roster the two values differ by only ~0.4% (0.9820 vs 0.9781),
  // far too little to notice in any downstream figure. Asserted in
  // scripts/diagnostics/marketplace-generation-check.ts.
  kLineApplied?: number;
  // The risk-control effectiveness APPLIED TO THIS YEAR'S DRAW — the value
  // processLineYear projected for the year and handed to the generator.
  //
  // ⚠ DISTINCT FROM LinePoolState.riskControlEffectiveness, which is the rolling
  // CURRENT value and is overwritten every year. Regenerating a past year's
  // claims needs the value that year saw, and until this field existed only the
  // latest year's was anywhere. It is the one of claim regeneration's inputs
  // that was genuinely missing: roster (memberList) and k (kLineApplied) were
  // already here, gPool and the shock effects are derivable. Optional only for
  // results written before it existed; claimRegeneration THROWS on those rather
  // than guess.
  rcEffectivenessApplied?: number;
  // ENROLLED MEMBERS ONLY. This is the pool-accounting list: aggregateMemberLoss,
  // grossUltimateLoss, reserves and reinsurance all derive from it.
  memberLossResults: MemberLossResult[];
  // ALL 200 CANONICAL MEMBERS, enrolled and prospect alike — loss HISTORY only,
  // never pool accounting. Claims are generated marketplace-wide so that a
  // prospect arrives with a readable loss record instead of a blank one, which
  // is what lets an underwriting screen read experience rather than a hidden
  // risk-quality score.
  //
  // ⚠ DO NOT SUM THIS INTO ANY POOL FIGURE. Prospects pay no premium and cede
  // nothing; their losses are not the pool's. The enrolled entries here are the
  // same objects as memberLossResults above, so the two are consistent by
  // construction rather than by a second computation.
  //
  // Optional for the same reason claims? is: the aggregate (Property) path does
  // not produce it, and it is in-memory only.
  marketMemberLossResults?: MemberLossResult[];
  aggregateMemberLoss: number;
  commonLossFactor: number;
  catastropheFactor: number;
  // Claim-level detail, WC and GL (Property still draws an aggregate).
  //
  // IN-MEMORY FOR THE CURRENT SESSION ONLY. Dropped on the way to localStorage
  // by gameSave.ts's `SAVE_STRIPPED_KEYS`, so a restored game has aggregates and
  // no per-claim rows for years played before the reload. Optional for exactly
  // that reason: any consumer must handle its absence, and after a reload every
  // consumer will meet it.
  //
  // ⚠ WHAT STOOD HERE WAS FALSE IN BOTH HALVES, AND THE COST WAS REAL. It said
  // this was "deliberately NOT persisted to localStorage (~800 claims/yr x years
  // would blow the quota)" and that detail "is regenerated from seed x member x
  // year on demand".
  //
  //   IT WAS PERSISTED. `persistState` was a bare JSON.stringify of the whole
  //   GameState. Nothing stripped anything, because the stripping this sentence
  //   described did not exist anywhere.
  //
  //   IT DID BLOW THE QUOTA. Three lines, ten years: 10.24 MiB against a
  //   measured 5 MiB limit, first crossed at YEAR 4 — after which every save
  //   threw QuotaExceededError into a bare catch {} and the game silently
  //   stopped being recorded.
  //
  //   AND FOR A LONG TIME THERE WAS NO REGENERATION. The claim was repeated in
  //   four comments and implemented in none, and it was not achievable as
  //   stated: the register depends on the enrolled roster,
  //   riskControlEffectiveness, k_line, gPool and any shock multipliers — the
  //   decision PATH, not (seed, member, year). Measured: the same seed with one
  //   pool-wide risk-control change moves GL's AY3 register from 261 claims /
  //   $12.598M to 236 / $11.863M.
  //
  // ⚠ IT IS TRUE NOW, AND HERE IS WHAT MAKES IT TRUE. claimRegeneration.ts's
  // regenerateLineYearClaims redraws a line-year from what this ResultSet
  // carries — `memberList` (the roster the generator saw), `kLineApplied`,
  // `rcEffectivenessApplied` (added for this; see its note), `calendarYear`,
  // `yearNumber` — plus two values that are pure functions of persisted state:
  // gPool from (seed, year) and the shock effects from (instance, year). One
  // number per line-year was added and nothing else. The per-member
  // RNG streams (enrolment-independence-check) make the redraw exact, and
  // save-round-trip-check asserts it FIELD BY FIELD against a straight-through
  // game, ids included. A ResultSet from before `kLineApplied` existed cannot be
  // regenerated and the function THROWS rather than guessing k = 1.
  //
  // A comment describing behaviour nobody implemented read as a guarantee for
  // the life of the project. It describes a real function now, and the function
  // has a gate.
  claims?: Claim[];
  occurrences?: Occurrence[];
  claimCountsByClass?: Record<string, number>;  // WC
  claimCountsByTier?: Record<string, number>;   // WC
  claimCount?: number;                          // GL — total claims generated this line-year, no sub-coverage breakdown anymore
  grossUltimateLoss: number;
  // ⚠ NOT THE SHOCK EVENT SYSTEM. This flag predates it and already carries
  // THREE different line-specific meanings — a WC catastrophic-tier claim, a GL
  // occurrence over $1M, or Property's aggregate factor exceeding its
  // threshold. Configured shock events record on `shockEvents` below, on a
  // separate channel, precisely so that overloading this one does not corrupt
  // three live signals.
  shockLossIncurred: boolean;
  // Configured shock events in force this year that touched THIS line. Absent
  // when none are — an array field, so value-identity-check (which captures
  // only numeric fields) is blind to it by construction.
  shockEvents?: ShockRecord[];
  reinsuranceCost: number;
  reinsuranceRecovery: number; // reinsurer's paid share of ceded loss
  // --- per-occurrence tower outputs, every line ---
  // Ceded by layer, index-aligned to REINSURANCE_TOWER[line].
  cededByLayer: number[];
  // What the pool keeps ABOVE THE TOP OF THE TOWER. On GL this is the band no
  // market will write and it EXCEEDS the top layer the pool buys, so it is
  // displayed rather than left implicit. Mean is indicative only — the band is
  // unbounded (GL severity is Pareto alpha 1.3) and has no valid CI.
  retainedAboveTower: number;
  // WC aggregate stop-loss on total annual retained loss. 0 when not purchased.
  aggregateRecovery: number;
  aggregatePremium: number;
  aggregateAttachment: number;
  netUltimateLoss: number;
  netIncurredLoss: number;      // netUltimateLoss adjusted for prior-year reserve development

  // Expenses
  operatingExpense: number;
  riskControlInvestment: number;

  // Reserve development (NET basis — reserves are net of reinsurance)
  priorYearDevelopment: number; // positive = favorable, negative = adverse
  // ⚠ WHAT THE TOWER ABSORBED OF THIS YEAR'S PRIOR-YEAR DEVELOPMENT, AND NOTHING
  // ELSE. Positive = the reinsurer took it. Adverse development on a claim
  // already above the retention cedes, so the pool's own reserve moves by the
  // RETAINED part only.
  //
  // ⚠ IT USED TO ALSO CARRY bookingGiveBack AND THAT WAS A DEFECT. The two are
  // unrelated events — one is cession on a PRIOR accident year's deterioration,
  // the other is recovery deferred on THIS year's inception — and summing them
  // gave a field that was only correct once a reader subtracted one back out.
  // Measured on one WC year: the field read $3,531,155 while the actual
  // development cession was $6,177,235 and the give-back was -$2,646,080. Any
  // consumer computing "gross development = net + this field" was short by the
  // give-back. One field doing two jobs, with a name that invites the wrong one.
  //
  // GROSS PRIOR-YEAR DEVELOPMENT IS priorYearDevelopment MINUS this, with nothing
  // to correct. ⚠ THE SIGN WAS WRONG HERE AND READ "+ this". Both fields are
  // favourable-positive on the net ultimate (developmentImpact accumulates
  // `c.netUltimate - newUltimate`) while this one is positive when the reinsurer
  // ABSORBS adverse movement, so the retained figure is the LESS adverse of the
  // two and the gross is recovered by subtracting. The old wording is right in
  // MAGNITUDE for an adverse year — |gross| = |net| + ceded — and wrong in sign,
  // which is exactly the shape that survives a spot-check and misleads a reader
  // computing the favourable side.
  //
  // ⚠ THIS IS A MEMO FIGURE AND MUST NOT BE ADDED TO INCOME AGAIN. It is the
  // same convention as reinsuranceRecovery beside it: netUltimateLoss is
  // already net of that recovery, and priorYearDevelopment is already net of
  // this one. Both exist so a player can SEE the cover respond; neither is a
  // second credit. Adding either to net income double-counts it.
  priorYearDevelopmentCeded: number;
  // ⚠ RECOVERY DEFERRED BY BOOKING THIS YEAR'S CLAIM REGISTER LOW. Negative, and
  // STANDS ALONE — it is no longer folded into priorYearDevelopmentCeded.
  //
  // DEFERRED, NOT FORGONE, and the word matters. Marking the register down for an
  // optimistic booking reduces the recoverable along with the claims, but the
  // unwind restores both: every dollar deferred here comes back through
  // priorYearDevelopmentCeded as the accident year develops. Calling it
  // "forgone" would assert a permanent loss and there is not one.
  //
  // A CURRENT-YEAR ITEM, so it belongs beside the current-year recovery it
  // reduces — not beside prior-year development, where it was mislabelled.
  // Zero whenever the line was funded at or above break-even.
  bookingGiveBack: number;
  beginningNetReserve: number;
  currentYearNetReserve: number; // case reserve for this accident year, net
  // ibnrReserve / ibnrAccrual / emergedPriorYearLoss / unreportedClaimCount are
  // gone with WC's report lag — see the note in simulationEngine where the
  // provision used to be computed, and the IBNER replacement it records.
  netPaidLosses: number;
  endingNetReserve: number;

  // Investment
  investmentReturnRate: number;
  investedAssets: number;
  investmentIncome: number;

  // Inter-line loan (Stage 1.6). All zero/false for a line with no loan activity.
  outstandingLoanBalance: number;   // this line's outstanding inter-line loan balance at year-end
  loanRepaymentApplied: number;     // net income skimmed this year to repay the loan
  loanInterestAccrued: number;      // interest added to the balance this year
  loanOriginatedThisYear: number;   // principal of a loan originated this year (0 if none)

  // ⚠ WHAT INTER-LINE LENDING DID TO THIS LINE'S BALANCE SHEET THIS YEAR, and it
  // exists because THE LENDER SIDE HAD NO FIELD AT ALL. The four fields above are
  // all BORROWER-side: a line that LENDS $26M sees its surplus and investments
  // fall by $26M with every one of them still reading zero. Nothing downstream
  // could tell a lender's balance sheet from an unexplained hole in it, and the
  // audit page's cash/investment reconstruction — written before inter-line
  // lending existed — silently omitted the term and reported a $26.40M gap as a
  // formula failure.
  //
  // Sign is FROM THIS LINE'S POINT OF VIEW: positive when the line received
  // (borrowed proceeds, or a repayment credited back to it as a lender),
  // negative when it paid (its share of a loan it funded, or a repayment it
  // made). Covers BOTH passes — the in-year repayment and the post-authorization
  // transfer — so it is the complete post-sweep movement, not just origination.
  //
  // ⚠ IT SUMS TO ZERO ACROSS LINES, BY CONSTRUCTION. Every dollar one line
  // receives another line paid, so the POOL row is always 0 and that is a real
  // check rather than a definition — the two sides are written at different
  // places in the engine and a pool total that drifts off zero means one of them
  // is wrong.
  // ⚠ THE SHARE OF THIS LINE'S ENDING NET RESERVE EXPECTED TO PAY WITHIN 12
  // MONTHS, reserve-weighted across the cohorts it actually holds.
  //
  // It exists because the payout pattern made the old display wrong. The
  // balance sheet's current/noncurrent split used to be `endingNetReserve x
  // LINE_RESERVE_PAYDOWN_PCT[line]`, which worked only because that rate was the
  // same for every cohort. Under a pattern the rate depends on each cohort's
  // AGE — WC pays 25.5% of a one-year-old's balance and 13.9% of a nine-year-
  // old's — so the correct current portion is a weighted blend that needs the
  // cohorts, and the pages have only the result. The engine has both, so it
  // emits the blend rather than the pages guessing at it.
  //
  // Zero when the line holds no reserve; a rate on nothing has no meaning and
  // the alternative is a NaN on the balance sheet.
  nextYearPaydownRate: number;

  interLineTransfer: number;
  // The part of `interLineTransfer` that moved through CASH rather than
  // investments. Non-zero only when a repayment exhausted the line's portfolio
  // and had to come out of operating cash; every other movement is investments.
  // Carried separately because the sweep reconstruction has to split the term
  // between the two accounts and cannot recover the split from anything else.
  interLineCashTransfer: number;

  dividendBlocked: boolean;         // true if this line's dividend was blocked (negative surplus carried in)

  // CLF / Funding Confidence
  //
  // Important model distinction:
  // - Accounting reserves are expected unpaid claims from incurred losses.
  // - CLF does not multiply booked accounting reserves.
  // - CLF is used for premium funding adequacy and reserve confidence analysis.
  // - Capital cushion compares surplus to the extra CLF margin above booked expected unpaid losses.

  selectedFundingConfidenceLevel: number;  // Player-facing selection, e.g. 0.75
  selectedFundingCLF: number;              // Backend actuarial factor from CLF table

  // A. Rate / Premium Funding Adequacy
  //
  // ⚠ THIS BLOCK IS NOW TWO FIELDS, AND EVERYTHING ELSE IN IT IS DELETED. It held
  // twelve. Seven went here; five went at ebdb147 (premiumFundingRatio,
  // premiumFundingAdequacyStatus and three aliases of them). Not one of the
  // twelve was ever read by a page, a RESULT_METRICS entry, a narrative or a
  // financial statement — the section was written as a funding-adequacy exhibit
  // and the exhibit was never built.
  //
  // THE SEVEN REMOVED HERE, and how each was assigned:
  //   requiredFundingPremium      = poolPremiumAndAdminExpense   (alias)
  //   actualPremium               = poolPremiumAndAdminExpense   (alias, same one)
  //   premiumFundingGap           = 0                            (literal)
  //   indicatedFundingRatePer100  = poolPremiumRatePer100 + adminRatePer100
  //   actualRatePer100            = indicatedFundingRatePer100    (alias)
  //   rateFundingGapPer100        = 0                            (literal)
  //   rateAdequacyRatio           = 1                            (literal)
  //
  // The gap was 0 and the ratio 1 BY CONSTRUCTION, because the two quantities
  // they compared were the same value under two names. That is the tell the
  // absolute identity check now looks for: five of these seven are bit-exact
  // constants on every instance, which is what a quantity that was never
  // computed twice looks like.
  //
  // THE CONCEPT SURVIVES UNDER ITS REAL NAME. "Premium over required premium"
  // IS selectedFundingCLF, where 1.000 is break-even by construction, and the
  // live code reads that directly — IBNER's booking bias, the funding panel, the
  // audit page's rate build-up. Nothing needed reconnecting.
  expectedLoss: number;                    // Current-year expected loss before CLF
  clfAdjustedExpectedLoss: number;          // expectedLoss × selectedFundingCLF

  // B. Accounting Reserve / Reserve Confidence View
  expectedNetUnpaidLoss: number;            // Expected unpaid losses (net of reinsurance)

  netFundingTarget: number;                 // expectedNetUnpaidLoss × selectedFundingCLF
  indicatedNetReserveAtConfidenceLevel: number; // Confidence-level indication, not booked reserve

  fundingMarginNeeded: number;              // Legacy name for reserveRiskMarginNeeded
  reserveRiskMarginNeeded: number;          // netFundingTarget - expectedNetUnpaidLoss

  // C. Capital / Surplus Cushion
  availableFunding: number;                 // Legacy name; equals endingSurplus
  availableSurplus: number;                 // endingSurplus
  fundingGap: number;                       // Legacy name for capitalFundingGap
  capitalFundingGap: number;                // availableSurplus - reserveRiskMarginNeeded
  excessAvailableSurplus: number;           // surplus - required reserve margin
  excessCapitalRatio: number | null;        // excess / required reserve margin
  capitalAdequacyRatio: number | null;      // Legacy alias for excessCapitalRatio
  capitalAdequacyStatus: string;            // "Strong" | "Adequate" | "Thin" | "Deficient"

  // Legacy compatibility
  fundingCLF: number;                       // Alias for selectedFundingCLF

  // Income statement
  underwritingIncome: number;   // totalMemberCharge + assessments − netIncurredLoss − operatingExpense − riskControlInvestment − reinsuranceCost − dividends
  netIncome: number;            // underwritingIncome + investmentIncome

  // Balance sheet
  beginningCash: number;
  endingCash: number;
  beginningInvestments: number;
  endingInvestments: number;
  totalAssets: number;
  unearnedPremium: number;
  totalLiabilities: number;
  beginingSurplus: number;
  endingSurplus: number;

  // Surplus rollforward validation
  surplusFromIncome: number;                // beginingSurplus + netIncome
  surplusTieOutDifference: number;          // endingSurplus - surplusFromIncome

  // Ratios — EVERY ONE STATES ITS DENOMINATOR, because THREE now exist and
  // mixing them is finding 6's recurring error.
  //   pricing basis       = poolPremiumAndAdminExpense (poolPremium + admin)
  //   member-charge basis = totalMemberCharge (the above + reinsurance cost)
  //   retained premium    = poolPremium alone (no admin, no reinsurance)
  // A loss ratio and an expense ratio may only be ADDED when they share a
  // denominator, which is why the combined ratios use the member-charge basis
  // on both terms.
  //
  // ⚠ NAMING THE FIELD WAS NOT ENOUGH, AND THAT IS WHAT THIS BLOCK GOT WRONG.
  // Every field here has stated its basis since finding 6, and two playtesters
  // still read the headline as a calibration failure — because the four places
  // a player actually looks rendered `actualLossRatio` under the label "Pool
  // Loss Ratio", which names a SCOPE and not a BASIS. The discipline has to
  // reach the LABEL, not just the field. See the display note at Header.tsx.
  expectedLossRatio: number;             // PRICING basis — the finding-6 reconciliation figure
  expectedLossRatioMemberBasis: number;  // MEMBER-CHARGE basis — the combined-ratio component
  expectedExpenseRatio: number;          // MEMBER-CHARGE basis
  expectedCombinedRatio: number;         // member-charge basis on both terms
  actualLossRatio: number;               // MEMBER-CHARGE basis
  // PRICING basis. Shares expectedLossRatio's denominator, so these two are the
  // only expected/actual pair in this type that may be compared directly — and
  // that comparability is why the headline uses this one.
  actualLossRatioPricingBasis: number;
  // RETAINED PREMIUM alone. No expected counterpart and no expense ratio on its
  // basis, so it may not be added to anything: a reported figure only.
  actualLossRatioRetainedPremium: number;
  actualExpenseRatio: number;            // MEMBER-CHARGE basis
  actualCombinedRatio: number;           // member-charge basis on both terms
  combinedRatio: number;
  lossRatio: number;
  expenseRatio: number;

  // Narrative
  narrativeExplanation: string;

  // Provenance of the pre-game reject-and-redraw bootstrap (priorHistoryEngine).
  // Set only on pre-game years (yearNumber <= 0), per line, so the exact
  // effective seed that produced that line's history — instance.seed +
  // pregameAttempt x 997 — is derivable from saved state. Undefined for live
  // years and for the pool-level aggregate (each line can carry a different
  // attempt, so there is no single pool-level value).
  pregameAttempt?: number;

  // Per-line breakdown. Pool-level fields above are aggregates across active
  // lines (dollar/count fields summed, ratios recomputed from the summed
  // components); this map retains each line's own unaggregated result.
  byLine: Record<CoverageLine, LineResultSet>;
}

// A single line's own result for the year, before pool-level aggregation.
export type LineResultSet = Omit<ResultSet, 'byLine'>;

// UI display filter (Stage 2.1): 'pool' shows the combined/summed totals;
// a specific line filters every figure on the page to that line's slice.
export type LineView = 'pool' | CoverageLine;

// Per-line pool state (rolled from year to year)
export interface LinePoolState {
  rateLevel: number;           // cumulative rate index (starts at 100)
  ratePer100: number;          // rate per $100 of payroll (e.g. 7.50)
  purePremiumPer100: number;   // expected loss cost per $100 payroll
  /** @deprecated use purePremiumPer100 */
  purePremium: number;         // kept for backward compat — equals purePremiumPer100
  memberSatisfaction: number;
  averageRiskQuality: number;
  riskControlEffectiveness: number; // rolling score 0-1
  reserveCohorts: ReserveCohort[];
  // Append-only development ledger, one row per accident year, never pruned —
  // see ReserveDevelopmentRow. Optional because saves written before the
  // Actuarial memorandum existed do not carry it; read it as `?? []` and the
  // exhibit is simply empty on those, which is honest rather than invented.
  reserveDevelopment?: ReserveDevelopmentRow[];
  // WC ONLY, empty on GL and Property. Claims drawn but not yet reported.
  //
  members: Member[];
  netUnpaidReserve: number;    // unpaid loss reserve, net of reinsurance
  surplus: number;
  investedAssets: number;      // this line's own segregated investment portfolio (Stage 2.9),
                               // carried forward year to year like surplus
  totalMarketExposure: number;
}

// One continuous stretch of enrollment in a single coverage line, in ACTIVE
// yearNumbers, inclusive on both ends (pre-game years are negative). A member
// withdrawn during year Y's movement was last active in Y-1, so its interval
// closes with endYear = Y-1; endYear null = currently enrolled.
export interface EnrollmentInterval {
  startYear: number;
  endYear: number | null;
}

// The authoritative per-member, per-line enrollment record, keyed by member
// id then coverage line: every past and present active interval, supporting
// "was member X active in line Y during year Z" for any combination,
// including multiple past intervals per member per line. Member.yearJoined /
// yearWithdrawn remain as DENORMALIZED convenience fields only — per-line
// questions (e.g. the re-enrollment cooldown) must be answered from this
// ledger, never from Member.status, which is fold-corrupted across lines
// (see membershipHistory.ts).
export type MembershipHistory = Record<string, Partial<Record<CoverageLine, EnrollmentInterval[]>>>;

// One member-line-year of loss experience. See src/utils/memberLossHistory.ts
// for what each leg includes and — importantly — what it deliberately does not.
export interface MemberLossYear {
  yearNumber: number;   // pre-game years negative, matching every other yearNumber here
  actual: number;       // that year's drawn gross ultimate loss for this member
  expected: number;     // the analytic expectation AS IT STOOD THAT YEAR (not recomputed later)
}

// Rolling per-member, per-line loss history, keyed memberId -> line -> years.
//
// KEYED PER (MEMBER, LINE) because enrolment is per line — a member can be in WC
// and not GL, and their experience differs accordingly.
//
// PLAIN JSON-SERIALISABLE, AND THAT IS A HARD REQUIREMENT, NOT A PREFERENCE.
// The whole GameState goes through JSON.stringify in App.tsx, where a Map
// serialises to {} SILENTLY — no error, no warning, just an empty object on the
// next load. Records and arrays only. Same constraint as MembershipHistory.
export type MemberLossHistory = Record<string, Partial<Record<CoverageLine, MemberLossYear[]>>>;

// Pool ongoing state: fields shared across all lines, plus one LinePoolState per
// line. Investments are NOT here — each line holds its own portfolio (Stage 2.9);
// cash remains shared and is split by contribution share.
export interface PoolState {
  cash: number;
  unearnedPremium: number;
  allMarketMembers: Member[];      // the full canonical marketplace (200 members)
  lines: Record<CoverageLine, LinePoolState>;
  interLineLoans: InterLineLoan[]; // pool-level ledger of outstanding inter-line loans
  membershipHistory: MembershipHistory; // authoritative per-line enrollment intervals
  // Rolling per-member, per-line actual/expected loss record — the input the
  // experience modifier (stage 4) reads. Maintained marketplace-wide, so
  // prospects carry history too.
  //
  // ON PoolState, NOT ON Member, deliberately. Member is a generated,
  // seed-independent catalog entry (memberCatalog.ts) shared by every game;
  // hanging per-game simulation state off it would make the catalog stateful and
  // would mean two concurrent games mutate each other's members.
  //
  // OPTIONAL because saves predating stage 3 lack it. App.tsx defaults it to {}
  // on load rather than bumping the save key — same precedent as
  // membershipHistory, and discarding a save over an additive field would be a
  // worse trade.
  memberLossHistory?: MemberLossHistory;
}

// Top-level game state
export interface GameState {
  setup: GameSetupSettings;
  instance: GameInstance;
  currentYearNumber: number;
  isStarted: boolean;
  isComplete: boolean;
  poolState: PoolState;
  lockedResults: ResultSet[];
  currentDecisions: DecisionSet;
  // Stage 2.10: the 3 simulated pre-game years (yearNumbers -2, -1, 0), run
  // through the real engine at default decisions. Year 0's ending state IS the
  // Year 1 opening position; year 0's result is Year 1's priorResult.
  priorHistory: ResultSet[];
}

// Starting financial position
export interface StartingFinancials {
  cash: number;
  investments: number;
  totalAssets: number;
  netUnpaidReserve: number;    // unpaid loss reserve, net of reinsurance
  unearnedPremium: number;
  totalLiabilities: number;
  surplus: number;
  annualPremium: number;
  expectedLossRatio: number;
  memberSatisfaction: number;
  riskQuality: number;
  surplusToPremiumRatio: number;
  activeMembers: number;
  activeExposure: number;      // payroll in $M
  totalMarketExposure: number; // payroll in $M
  marketShare: number;
  rateLevel: number;
  ratePer100: number;          // rate per $100 payroll
  purePremiumPer100: number;   // expected loss per $100 payroll
  purePremium: number;         // kept for compat
}

// V2: ChartDataPoint for future chart support
export interface ChartDataPoint {
  yearNumber: number;
  calendarYear: number;
  value: number;
  label: string;
}

// V2: LossDistributionConfig for more advanced modeling
export interface LossDistributionConfig {
  distributionType: 'lognormal' | 'gamma' | 'normal';
  mean: number;
  cv: number;
}

// ⚠ `ReserveDevelopmentState` IS GONE, and IBNER is why. It was a speculative
// "V2" placeholder for a full accident-year triangle —
// { accidentYear, developmentPattern, selectedFactors } — never referenced from
// anywhere. It described a DIFFERENT reserving design from the one that now
// exists: IBNER develops a per-cohort estimate through a horizon and a step
// walk, with no triangle and no selected factors to hold. Keeping it would
// advertise a direction the engine has already taken elsewhere.
//
// Its sibling `LossDistributionConfig` above is the same kind of placeholder and
// is deliberately LEFT: nothing in the cap work or IBNER retired it, and
// deleting it here would fold an unrelated cleanup into this commit. It is
// reported as part of a wider orphan cluster instead.
