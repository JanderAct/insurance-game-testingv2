// ============================================================================
// CLAIM CLOSURE — when a file stops being open, as distinct from when it is paid.
//
// Money leaves before files close, and the two curves are INDEPENDENT. WC pays
// 41% of a cohort in its first year and closes 49% of its claims; GL pays 10%
// and closes 27%. Deriving one from the other would collapse a real distinction:
// a closed claim has paid everything it will ever pay, an open one has not, and
// the share of a cohort's dollars that has left is not the share of its files
// that are finished. So this module never reads payoutPattern.ts and
// payoutPattern.ts never reads this one.
//
// SAME FORM AS THE PAYOUT PATTERNS, for the same reason — a curve with recorded
// parameters rather than a table, so a valuation at any age is defined and no
// interpolation rule has to be invented:
//
//     closedShare(t) = 1 - exp(-(t/b)^k)
//
// where t is YEARS SINCE THE ACCIDENT YEAR, on the same convention
// payoutPattern.ts uses: a cohort at `age = a` sits at curve age a + 1.
//
// ⚠ FITTED AGAINST REAL POOL EXPERIENCE, EACH LINE SEPARATELY, AND THE SOURCE
// DATA IS NOT IN THIS REPO. The parameters ARE the record — the same discipline
// FITTED_PAYOUT_PATTERN carries, and the same reason: the shape came from the
// pool's own closure experience and the fit is what survives, not the triangle
// it was fitted against.
// ============================================================================

export interface ClosureCurve {
  /** Shape. k < 1 closes fast then crawls; k > 1 defers then accelerates. */
  k: number;
  /** Scale, in years. */
  b: number;
}

/** Share of an accident year's claims closed by curve age `t` (years). */
export function closedShare(c: ClosureCurve, t: number): number {
  if (t <= 0) return 0;
  return 1 - Math.exp(-Math.pow(t / c.b, c.k));
}

// ============================================================================
// A CLAIM'S OWN CLOSURE DRAW — deterministic, storage-free, monotone, AND
// INDEPENDENT ACROSS GAMES.
//
// ⚠ IT HAS TO BE DERIVED RATHER THAN STORED. Ruling 8 keeps the claim register
// out of persistence: `LineResultSet.claims` is in-memory only and per-claim
// detail regenerates from seed x member x year on demand. So a claim's status
// cannot be accumulated state — it has to be a pure function of what the claim
// already carries.
//
// Each claim gets one uniform, fixed for its life. It is closed at curve age t
// exactly when the closure share has reached that uniform. Because the share is
// monotone increasing in t and the uniform never moves, a claim closed at one
// valuation is closed at every later one — closure cannot un-happen, which a
// per-valuation draw would allow.
//
// ⚠ THE GAME IDENTITY IS AN INPUT, AND ITS ABSENCE WAS A DEFECT. Claim ids carry
// no seed — `wc-1-member-004-large-0` is the same string in every game — so
// hashing the id alone gave the same closure unit to the same SLOT in every
// game. Measured across two games with unrelated seeds: 21.9% of WC claim ids
// collided (GL 2.8%, Property 12.9%), and NONE of the collisions carried the
// same claim amount. A closure-driven carrier set would then evolve partly
// independently of the seed, which is exactly what
// enrolment-independence-check exists to prevent elsewhere.
//
// ⚠ THE SEED GOES IN THE HASH, NOT IN THE ID, and that is the cheaper of two
// correct fixes. Claim ids are join keys — the claims workbook joins them to
// occurrence development, and the development ledger keys off them — so changing
// their SHAPE has reach into every consumer. Hashing (gameId, claimId) buys the
// same independence and touches nothing that joins. In the app the numeric seed
// is `seedFromInstanceId(instanceId)`, a pure function of the instance id, so
// the two carry identical information and the id is the one already threaded to
// every call site that needs it.
//
// ⚠ AND THE HASH NEEDS ITS FINALISER. This was plain FNV-1a returning the TOP 24
// bits, and FNV's last multiply leaves the high bits poorly diffused on short
// structured keys. Measured mean unit: WC 0.4882 against 0.5000, chi-squared(9)
// of 258 against a 21.7 critical value, biasing WC's age-1 closure +1.75 points.
// GL read clean at 0.4994 — its ids are fixed-shape and end `-c1`, while WC's
// end in a variable-length component token and run 23-32 characters. A hash that
// is uniform on the line you happen to test first is the failure mode here, so
// closure-draw-check asserts uniformity PER LINE.
//
// FNV-1a plus an xorshift-multiply avalanche, and deliberately NOT the project's
// SeededRandom: this is not a simulation draw and must not touch any RNG stream.
// Consuming from a seeded stream would move every downstream draw and re-roll
// the game, for a quantity that is a read-time property of a claim that already
// exists.
// ============================================================================
export function claimClosureUnit(gameId: string, claimId: string): number {
  let h = 2166136261 >>> 0;
  // The game identity first, separated by a byte that cannot occur in either
  // string, so (gameId, claimId) can never be confused with a different split of
  // the same concatenation.
  for (let i = 0; i < gameId.length; i++) {
    h ^= gameId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= 0x1f;
  h = Math.imul(h, 16777619) >>> 0;
  for (let i = 0; i < claimId.length; i++) {
    h ^= claimId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // The avalanche. Without it the top bits carry the bias measured above.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/**
 * Is this claim closed as at curve age `t`?
 * `curve` is the claim's own — see resolveClosureCurve for the size split.
 */
export function isClaimClosed(curve: ClosureCurve, gameId: string, claimId: string, t: number): boolean {
  return closedShare(curve, t) >= claimClosureUnit(gameId, claimId);
}

// ============================================================================
// THE PER-CLAIM PAYMENT SPLIT — A SPLIT, NEVER A SCHEDULE.
//
// ⚠ NO CLAIM EVER DRAWS ITS OWN PAYMENT SCHEDULE, and this is the load-bearing
// prohibition of the whole paid ledger. Read the reason before changing anything
// here, because the failure it prevents is invisible from this file.
//
// The engine develops the RESERVE, not the ultimate:
//
//     newUnpaid = (netUnpaid - paydown) x factor
//
// so the cohort's paydown TOTAL sets the base that development multiplies. Pay
// more this year and the same factor moves fewer dollars; development shrinks,
// and cession shrinks with it. Payment allocation is cession-neutral ONLY
// because the payout pattern fixes that total before any split happens.
//
// cedeDevelopment reads `c.current` and the deltas and nothing else, so payment
// cannot reach the cession function directly. The danger is entirely indirect
// and entirely through the total. Give a claim its own payment curve and the
// cohort total stops being the pattern's, the development base moves, and the
// free-lunch surface reopens somewhere nothing is watching.
//
// So: this returns a WEIGHT that sums to one over the register. The dollars come
// from the cohort's own gross paydown, which the pattern already set.
// paid-ledger-check.ts asserts the sum to the cent at every valuation.
//
// ⚠ PRO RATA BY THE CLAIM'S OWN GROSS ULTIMATE, and the alternative is DEFERRED
// RATHER THAN REJECTED. A size-differentiated split — large claims paying slower,
// as they demonstrably close slower — would also sum to one and would also be
// cession-neutral. It is not done here because there is no fitted per-claim
// PAYMENT-by-size curve to do it with: the size-conditional experience this
// project has is about CLOSURE, and reusing a closure curve as a payment curve
// is exactly the collapse the header of this file refuses. When a payment-by-size
// fit exists, this weight is where it goes.
// ============================================================================
export function claimPaidWeight(claimGrossUltimate: number, registerGrossSum: number): number {
  if (!(registerGrossSum > 0)) return 0;
  return Math.max(0, claimGrossUltimate) / registerGrossSum;
}

/** This claim's share of the cohort's cumulative gross paid, in dollars. */
export function claimPaidToDate(
  cohortGrossPaid: number,
  claimGrossUltimate: number,
  registerGrossSum: number,
): number {
  return cohortGrossPaid * claimPaidWeight(claimGrossUltimate, registerGrossSum);
}
