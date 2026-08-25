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

export interface MemberSegment {
  type: MemberType;
  count: number;
  totalExposure: number;
  averageRiskQuality: number;
  averageSatisfaction: number;
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
  actualLossRatio: number;
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
  paydownPct: number;           // portion paid each year
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
  activeMembers: number;
  newMembers: number;
  withdrawnMembers: number;
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
  // IN-MEMORY FOR THE CURRENT SESSION ONLY — deliberately NOT persisted to
  // localStorage (~800 claims/yr x years would blow the quota); results saved
  // and reloaded carry the aggregates, and per-claim detail is regenerated
  // from seed x member x year on demand. Optional for exactly that reason:
  // any consumer must handle its absence.
  //
  // The one persisted exception that used to be noted here — WC's unreported
  // claim inventory — is gone with the report lag. Nothing per-claim is
  // persisted now, so the rule above has no exception.
  claims?: Claim[];
  occurrences?: Occurrence[];
  claimCountsByClass?: Record<string, number>;  // WC
  claimCountsByTier?: Record<string, number>;   // WC
  claimCount?: number;                          // GL — total claims generated this line-year, no sub-coverage breakdown anymore
  shockLossAmount: number;
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
  expectedLoss: number;                    // Current-year expected loss before CLF
  clfAdjustedExpectedLoss: number;          // expectedLoss × selectedFundingCLF
  requiredFundingPremium: number;           // CLF-adjusted loss + expense + RI + risk control
  actualPremium: number;                    // Usually grossPremium
  premiumFundingGap: number;                // actualPremium - requiredFundingPremium
  premiumFundingRatio: number;              // actualPremium / requiredFundingPremium
  premiumFundingAdequacyStatus: string;     // "Strong" | "Adequate" | "Thin" | "Deficient"

  indicatedFundingRatePer100: number;       // requiredFundingPremium / payroll units
  actualRatePer100: number;                 // selected/actual rate per $100 payroll
  rateFundingGapPer100: number;             // actualRatePer100 - indicatedFundingRatePer100
  rateAdequacyRatio: number;                // actualRatePer100 / indicatedFundingRatePer100

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
  // Going forward, fundingAdequacyRatio/status describe premium funding adequacy.
  fundingAdequacyRatio: number;             // Alias for premiumFundingRatio
  fundingAdequacyStatus: string;            // Alias for premiumFundingAdequacyStatus
  fundingCLF: number;                       // Alias for selectedFundingCLF
  fundingAdequacyIndicator: string;         // Alias for premiumFundingAdequacyStatus

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

  // Ratios — EVERY ONE STATES ITS DENOMINATOR, because two exist and mixing
  // them is finding 6's recurring error.
  //   pricing basis       = poolPremiumAndAdminExpense (poolPremium + admin)
  //   member-charge basis = totalMemberCharge (the above + reinsurance cost)
  // A loss ratio and an expense ratio may only be ADDED when they share a
  // denominator, which is why the combined ratios use the member-charge basis
  // on both terms.
  expectedLossRatio: number;             // PRICING basis — the finding-6 reconciliation figure
  expectedLossRatioMemberBasis: number;  // MEMBER-CHARGE basis — the combined-ratio component
  expectedExpenseRatio: number;          // MEMBER-CHARGE basis
  expectedCombinedRatio: number;         // member-charge basis on both terms
  actualLossRatio: number;               // MEMBER-CHARGE basis
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
