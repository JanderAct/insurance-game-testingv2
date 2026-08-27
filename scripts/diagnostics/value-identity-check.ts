// VALUE-IDENTITY CHECK — did any simulated VALUE move?
//
//   npx tsx scripts/diagnostics/value-identity-check.ts            # compare
//   npx tsx scripts/diagnostics/value-identity-check.ts --write    # re-capture
//
// ============================================================================
// THE DIVISION OF LABOUR — read before "improving" either gate.
//
// There are TWO export guards and they answer DIFFERENT questions. Neither
// subsumes the other, and collapsing them is the mistake this comment exists
// to prevent.
//
//   THIS SCRIPT (value identity)      solo-export-guard.ts (shape identity)
//   -----------------------------     ------------------------------------
//   "did any VALUE move?"             "did the export SHAPE change?"
//   keyed by FIELD NAME               SHA-256 of the exported CSV
//   order-independent                 order-sensitive
//   label-independent                 label-sensitive
//   new fields are reported,          any new row, renamed label or
//     NOT a failure                     reordering turns it red
//
// A DISPLAY-LAYER FIX should be GREEN here and RED on the hash guard: it
// corrects what is shown without touching what is computed.
// AN ENGINE REGRESSION should be RED here — that is the signal that matters.
//
// This distinction is not theoretical. The expected-combined-ratio fix
// corrected two exported metric values, added one metric and renamed six
// labels. The hash guard went red on all 12 exports, which by its construction
// it HAD to, and that told us nothing about whether the engine had moved.
// This check answered it in one run: 14,400 numeric fields bit-identical, with
// movement confined to the two metrics the fix targeted plus the one it added.
//
// So: THIS is the primary gate for display-layer work. The hash guard is the
// shape check — still valuable, because an unintended column reorder or a
// dropped row is invisible here. Do NOT "fix" a red hash guard by re-hashing
// without first confirming this check is green, and do NOT delete the hash
// guard because this one is stricter about values. They are complementary.
// ============================================================================
//
// Coverage matches the hash guard exactly — same 3 seeds x 4 line
// configurations x 5 years — so the two are directly comparable. Every finite
// numeric field on every line result AND on the pool result is captured, which
// is roughly 14,850 values.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// v6: retired v5 at the per-member RNG stream change plus the deriveSubRng
// finalizer that change proved necessary (finding 26).
//
// Measured for the PER-MEMBER KEYING ALONE, which is the diagnostically useful
// decomposition: 6,404 of 14,850 fields moved across WC-solo/GL-solo/tri, and
// PR-solo moved 0 of 2,970 — Property is not on the claim-generator path, so
// that was the no-leak assertion, and it held. Field count stayed at 14,850
// with 0 added and 0 removed. Within the three moved scopes the ONLY field
// names that did not move are the same 28 structurally invariant ones in each:
// the HELD purePremium/purePremiumPer100 and the rate/CLF figures derived from
// it, decision inputs at defaults, and fields that are constant or identically
// zero (commonLossFactor and catastropheFactor are the legacy aggregate-path
// fields WC and GL no longer read). That is what a TOTAL move looks like — 43%
// of all fields reads as partial until it is partitioned by scope.
//
// The finalizer then moved everything again, Property included, because it
// changes seed derivation for every label. v6 reflected both.
//
// v7: MARKETPLACE-WIDE GENERATION, and it is an ADDITIVE SHAPE CHANGE ONLY —
// 0 of 14,850 values moved. Claims are now generated for all 200 canonical
// members, but per-member stream keying means a prospect's draws come from that
// prospect's own stream and cannot touch an enrolled member's, so every pool
// figure is bit-identical to v6. The only difference is 60 new kLineApplied
// fields. That zero-movement result IS the containment proof for stage 2, on
// top of a 40-seed attribution run showing the enrolled drawn/expected ratio
// unchanged to four decimals.
//
// v8: CLF-ONLY PRICING (decision-surface work). The Rate Change decision was
// deleted and the funding-confidence-level default moved from 0.75 to 0.60 —
// ISOLATED AND CONFIRMED SEPARATELY: with the default temporarily held at its
// old 0.75 value, this check read 0/14,910 changed, so the mechanical
// deletion of the three now-dead rateChange terms (all already zero at
// rateChange=0 defaults) moved nothing on its own. Every one of the 11,051
// changed values at the real 0.60 default was downstream of that one
// deliberate default change, not a side effect of the field removal.
//
// v9: TWO CORRECTIONS TO THE v8 WORK, EACH ISOLATED THE SAME WAY.
//   (1) updateSatisfaction's (fundingConfidenceLevel - 0.75) term went from
//       inert (zero at the old 0.75 default) to live AND BACKWARDS at the new
//       0.60 default — charging members less was making them unhappier.
//       Neutralised to coefficient 0 rather than sign-corrected: the 0.75
//       anchor is now arbitrary, and the whole term is slated for replacement
//       by bill-based satisfaction (Stage 2.5). Isolated with fix (2) held
//       back (CLF still 1.003): 2,302 changed across 71 fields, led by
//       memberSatisfaction itself (150 instances, e.g. 7 -> 7.4 — moving UP,
//       i.e. the wrong-signed drag being removed) and its retention/surplus
//       cascade.
//   (2) FUNDING_CLF_TABLE[0.60] moved from 1.003 to the reference chart's
//       1.000 — the chart is the authority. Isolated with fix (1) held back
//       (satisfaction coefficient still 0.5): 7,256 changed across 76 fields,
//       led by selectedFundingCLF itself (150 instances, 1.003 -> 1) and the
//       entire pricing/premium/reserve cascade at the 60% default.
// Combined (both fixes, the real shipped state): 8,135 changed across 77
// fields — NOT the sum of the two isolated runs (2,302 + 7,256 = 9,558),
// because the two channels interact nonlinearly (satisfaction feeds
// retention feeds exposure feeds premium, which the CLF fix also moves).
//
// v11: EIGHT ENGINE COMMITS, RECAPTURED TOGETHER RATHER THAN AFTER EACH ONE.
// aa0838a (per-occurrence reinsurance tower for WC AND GL) through a08b88e
// (wage inflation on WC's exposure base) — see the recapture commit for the
// full list. This baseline was allowed to go stale across all eight so that
// intermediate work could be isolated against its own parent commit instead
// (worktree + temporary capture script, five times); this is the first
// recapture since v10.
//
// 14,910 -> 16,110 fields (1,200 added, 0 removed): eight new fields
// (aggregateAttachment, aggregatePremium, aggregateRecovery,
// emergedPriorYearLoss, ibnrAccrual, ibnrReserve, retainedAboveTower,
// unreportedClaimCount) from the tower rebuild and the IBNR provision, each
// present on every scope regardless of active line (Property carries them at
// a fixed default — it is still on the legacy aggregate path).
//
// 7,863 of the 14,910 pre-existing fields changed, across 81 field names —
// entirely pricing/loss/reserve/membership cascade fields, nothing
// structural. By config: WC-solo 2,318/3,225 moved, GL-solo 2,045/3,225
// moved, tri 3,500/6,450 moved, PR-solo 0/3,210 moved.
//
// GL-solo moving is NOT a leak: aa0838a explicitly rebuilt GL's reinsurance
// from the old aggregate quota-share model to the same per-occurrence tower
// shape as WC, so GL's attachment/poolLosses/excessLosses/quotaShareLosses/
// netUltimateLoss/reinsuranceCost all changed model, and the resulting rate
// change cascades into memberSatisfaction, averageRiskQuality, activeExposure
// and marketShare through the ordinary retention/pricing feedback loop. The
// other seven commits (3181b18, 19d04e7, b4805bc, d66e8fb, cd154e2, 332cae4,
// a08b88e) touch WC only.
//
// PR-solo staying at 0/3,210 changed (0 added beyond the 240 shared new
// fields) IS the leak check this recapture needed: Property's engine was not
// touched by any of the eight commits, and this baseline proves it.
//
// v12: SIX MORE COMMITS, RECAPTURED TOGETHER: 23da65c, 72ecaa0, 4f695a0,
// 326e275, c1cec1b (GL's own rebuild — fitted-mixture severity, k_GL
// neutralised, severity trend, the $100M cap, GL's own CLF grid) and a21d01b
// (an "Expected" funding option, defaulting BOTH WC and GL to CLF = 1.000 in
// place of a fixed percentile stop). Plus 8c0ae6f, a UI-only squash-merge
// (the Welcome-to-Ripple setup modal) — CONFIRMED GATE-INERT: this script's
// full stdout, diffed byte-for-byte against a21d01b before the merge and
// after, came back empty.
//
// 16,110 -> 16,140 fields (30 added, 0 removed BY THIS TOOL'S COUNT — but
// that undercounts what actually changed shape: 23da65c replaced GL's
// claimCountsBySub (an object) with a scalar claimCount, and this script only
// ever tracks `typeof v === 'number'` fields, so the object-valued field's
// removal is invisible to it. The 30 additions are all one field name,
// claimCount, at 15 instances each in GL-solo and tri (3 seeds x 5 years).
//
// 6,393 of the 16,110 pre-existing fields changed, across 79 field names. By
// config: WC-solo 1,315/3,225 moved (0 new fields), GL-solo 2,155/3,225 moved
// (15 new), tri 2,923/6,450 moved (15 new), PR-solo 0/3,210 moved (0 new).
//
// WC-SOLO'S MOVEMENT IS ATTRIBUTABLE TO EXACTLY ONE MECHANISM — cross-checked
// against solo-export-guard.ts's v12 note, which bisected it directly: WC-solo
// held byte-identical through c1cec1b (the first five of the six commits are
// GL-only) and only started moving at a21d01b, whose sole WC-facing change is
// the fundingAtExpected ternary in simulationEngine.ts's selectedFundingCLF
// dispatch. GL-solo's 2,155/3,225 reflects the CUMULATIVE effect of all five
// GL-only commits plus a21d01b's GL-side default change — not isolated
// per-commit here, since none of the five were recaptured on their own (the
// same "recapture together, not after each" choice v11 made).
//
// PR-solo staying at 0/3,210 changed (0 new fields) IS the leak check this
// recapture needed: none of the six commits, nor the UI squash, touch
// Property.
//
// v13: ONE COMMIT, f5ece4d — moved WC and GL from frozen per-layer
// reinsurance constants to runtime computation of E[ceded] and SD[ceded] from
// the enrolled book and the current year, plus a fix to the WC aggregate's
// occurrence-frequency basis (nominal exposure -> real payroll x
// wcFrequencyTrend). A PRICING-BASIS change: no claim generator, severity,
// frequency or roster parameter moved, so every field that changed did so
// through the reinsuranceCost -> totalMemberCharge -> premium/reserve/
// membership cascade, not through a different loss draw.
//
// 16,140 -> 16,140 fields, 0 added, 0 removed. The six retired constants
// (expectedCededPer100, sdOverExpected, AGG_OCC_FREQ_PER_1M,
// AGG_OVERDISPERSION, WC_RETAINED_SECOND_MOMENT and its bitmask index) were
// all INTERNAL to reinsuranceTower.ts / towerMoments.ts — none was itself an
// exported LineResultSet/ResultSet field, so retiring them could not change
// export shape, only the values downstream of them. Confirmed rather than
// assumed: this scan's own added/removed counts are both zero.
//
// 3,820 of the 16,140 fields changed, across 71 field names. By config:
// WC-solo 953/3,225 moved, GL-solo 1,146/3,240 moved, tri 1,721/6,465 moved,
// PR-solo 0/3,210 moved. Led by reinsuranceCost itself (105 instances, e.g.
// $5,681,786 -> $8,025,186 on one WC line-year) and its cascade into
// totalMemberCharge, ratePer100, the loss/expense/combined ratios, and from
// there into retention, exposure and market share the ordinary way.
//
// PR-solo staying at 0/3,210 (0 new fields) IS the leak check this recapture
// needed: Property runs the legacy REINSURANCE_PROGRAMS path, untouched by
// f5ece4d, and this proves it was not reached.
//
// v14: EIGHT COMMITS — see solo-export-guard.ts's matching v13->v14 note for
// the full per-commit attribution; this note covers only what differs at the
// field-value level.
//
// 16,140 -> 15,540 fields, 0 added, 600 removed: ibnrReserve, ibnrAccrual,
// emergedPriorYearLoss, unreportedClaimCount, all from 962ef60 (WC's report
// lag and IBNR removed). 150 instances each (matching any other fully-
// populated field), NOT a WC-only 30 or 60 — these were LineResultSet fields
// present at 0 on every line ("WC only; 0 on GL and Property, which have no
// report lag", per the old type comment), so they populated every line's own
// scope AND the pool scope, on every config. None of the four was ever in
// RESULT_METRICS (checked against 962ef60^'s resultMetrics.ts — zero
// matches), which is why solo-export-guard's hash of the actual exported
// workbook never saw them and could not have caught this removal on its own;
// this scan's added/removed count is what does.
//
// 10,590 of the 16,140 baseline fields changed, across 78 field names. By
// config (numerator excludes the 4 removed fields; denominator is the v13
// baseline count for that config): WC-solo 2,113/3,225, GL-solo 2,133/3,240,
// PR-solo 2,068/3,210, tri 4,276/6,465.
//
// PR-solo MOVING IS NOT A LEAK — the opposite of the v13 pattern, and
// expected: fdc747c and bdc98ec are membership/pricing machinery shared by
// all three lines (each commit's own message says so, and the mechanism null
// test is the isolation used in place of a line control), and a3d7760's
// opening band applies per line to all three. The other five commits in this
// range (875cb75, fab85e4, f328d65, 3d3fbcc, 962ef60) are confirmed WC/GL-only
// by solo-export-guard's per-commit PR-solo hash check; this scan cannot
// separate their contribution from fdc747c/bdc98ec/a3d7760's inside one
// cumulative diff, which is why the hash guard's per-commit run is the
// isolation tool here, not this one.
//
// v19: retired v18 at the feature/ibner merge. Friedland IBNER replaces reserve
// development on ALL THREE LINES, so 9,120 of 15,300 fields moved and there is
// NO LINE CONTROL in this range for the first time — every previous recapture
// had a line that could not move and served as the leak test. The isolation was
// the MECHANISM NULL TEST instead: make both mechanisms inert and ask whether
// the trees agree. They do, once two non-mechanism channels are removed, and
// the ladder is in the lineage doc.
//
// ⚠ TWO THINGS A READER WILL GET WRONG FROM THE NUMBERS ABOVE THE LINE.
//
// FIRST, "0 added, 0 removed" DOES NOT MEAN THE DATA MODEL HELD. ReserveCohort
// gained five fields and lost `developmentFactor` in this range, and
// ReserveDevelopmentState was deleted outright. Cohorts live on poolState; this
// script walks ResultSet and LineResultSet, and the hash guard is scoped to
// RESULT_METRICS. Neither gate can see a cohort. The shape columns answer a
// narrower question than they look like they answer — fifth occurrence.
//
// SECOND, TWO COMMITS IN THE RANGE READ 0 OF 15,300 AND ARE STILL CORRECT.
// 4fbbb5a raised the booking-bias coefficient 1.6x and a84d854 rewrote the
// unwind schedule; both are invisible here because premiumFundingRatio is a
// hardcoded 1, so bookingBias is 0 on every cohort this gate ever constructs.
// ibner-null-check sections 3 and 4 squeeze funding to each line's reachable
// minimum stop and prove them there. Do not read a green gate as evidence a
// mechanism is inert when the gate cannot reach it.
// v20: retired v19 at the pool-scope aggregation audit.
//
// ⚠ THIS ONE MOVED THIS GATE WHILE BEING DISPLAY-ONLY, AND THAT IS NOT A
// CONTRADICTION — it is what this script captures. It records the POOLED row
// alongside each line, and the pooled row is precisely what was corrected. The
// decomposition is the whole proof:
//
//   37 changed, ALL in `tri`, ALL at `pool` scope, across four field names
//     (activeMembers 15, memberRetentionRate 15, withdrawnMembers 4, newMembers 3)
//   0 at ANY line scope        -> no aggregation feeds the engine
//   0 in WC-solo/GL-solo/PR-solo -> with one active line every aggregation is the
//                                   identity, so a solo pool cannot move unless
//                                   the aggregation itself is broken
//   150 added: enrolmentCount
//
// So "did a VALUE move" needs the scope partition to answer here. A red line
// scope would have meant the engine moved; a red solo config would have meant
// the aggregation broke. Both were green.
// v21: retired v20 across SEVEN commits, and it is the most boring range in this
// file's history — ZERO values moved at any of them. Every commit was diagnostic
// or display: the Calculation Audit page audited row by row, three new checks
// built over it, and every disagreement they found repaired.
//
// The whole range produced ONE shape change, at ebdb147: 300 removed
// (fundingAdequacyRatio and premiumFundingRatio, 150 instances each). FIVE fields
// were deleted there — the other three are STRINGS and this gate captures numbers
// only, so a five-field deletion reads as two here. That asymmetry is a property
// of the instrument, not of the change.
//
// ⚠ AND CLEARING THE PHANTOM IS PART OF THE POINT. That shape change sat in the
// v20 baseline for seven commits, so every run printed a standing "removed 300"
// line while still declaring HOLDS. A permanent informational line is not free:
// it is exactly what trains a reader to skim, and skimming is how the Market
// Share defect survived a release with a guard on it — its failure was sitting in
// a list of legitimately-moving fields. This capture reads 0 added, 0 removed.
//
// ⚠ MEASURED PER COMMIT EVEN THOUGH SIX ROWS WERE PREDICTED TO BE NOTHING, which
// is the case for doing it: a range where every row is expected to be zero is the
// one nobody verifies. All seven were run against the fixed v20 reference (valid
// because nothing in baselines/ and neither guard script changed in range), and
// solo-export-guard was run at every intermediate commit too — 84 hashes, all
// matching.
// v22: THE FIRST RANGE SINCE v11 IN WHICH THE ENGINE ITSELF MOVED, and it moved
// on every line at once. Reserve development now lands on CLAIMS and cedes
// through the occurrence tower, so 6,577 of 14,400 values changed across 74
// fields and all 12 export hashes differ. There is NO LINE CONTROL — the
// mechanism reaches WC, GL and Property identically — so the null test is the
// MECHANISM SWITCH: DEVELOPMENT_CESSION_ENABLED = false reproduces v21
// bit-for-bit, 0 values changed, 12/12 hashes matching.
//
// ⚠ TWO SHAPE ADDITIONS, BOTH MEMO FIELDS: priorYearDevelopmentCeded (what the
// tower absorbed of prior-year development) and bookingGiveBack (the recovery
// forfeited by booking the claim register low). NEITHER MAY BE ADDED TO INCOME —
// netUltimateLoss is already net of the first and priorYearDevelopment of the
// second, exactly as reinsuranceRecovery has always worked.
//
// ⚠ AND ONE SHAPE CHANGE THIS GATE CANNOT SEE. 1e05a55 added the
// reserveDevelopment ledger, which lives on LinePoolState rather than ResultSet,
// so it is invisible here — the sixth time this instrument's scope has mattered.
// It is a recording, not a value: 0 changed at that commit.
// v23: NO VALUE MOVED. The capture DOUBLED, from 14,400 fields to 28,800, because
// this gate gained a SQUEEZED ARM — see THE ARMS below. Every v22 key reappears
// under a `def|` prefix with a bit-identical value; everything new is `sqz|`.
//
// ⚠ THE ARM AND ITS BASELINE HAD TO LAND TOGETHER, and the laundering risk that
// normally argues against that is controlled a different way here. A recapture
// blesses whatever is in the tree, so the discipline is to separate the
// instrument change from the capture — but an arm with no baseline is a gate
// that cannot run, so there was nothing to separate them into. Instead the
// defaults half was diffed against v22 key-for-key BEFORE this file was written:
// 14,400 keys, 14,400 matched, 0 changed. The new content is a new arm on an
// unchanged tree, and that is checkable rather than asserted.
const BASELINE = path.join(__dirname, '../../baselines/VALUE_IDENTITY_v23.json');

function seedOf(id: string) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; }
  return h;
}

const SEEDS = ['MAMC6EA4', '6KA6WGLJ', 'ZZTEST99'];
const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];

// ============================================================================
// THE ARMS. BOTH, NOT JUST DEFAULTS.
//
// ⚠ THIS GATE WAS BLIND TO A REAL CHANGE AND READ CLEAN. At 932246f a field was
// split in two, moving 171 instances under squeezed funding — and this script
// and solo-export-guard BOTH reported 0 changed and 12/12 matching, because
// bookingGiveBack is bit-exactly 0 at default decisions and the split was
// therefore invisible at the only configuration either of them exercised.
//
// "Both gates identical" was a statement about ONE configuration, and this is
// the pair every commit is measured against. THIRD INSTRUMENT WITH THIS
// BLINDNESS: audit-formula-check had it and was given a squeezed arm at 118b1fb
// (which turned one reported defect into eleven), the absolute identity check
// has it and reports it, and this is the one that mattered most.
//
// The squeeze uses EACH LINE'S OWN REACHABLE MINIMUM, not a flat value — WC
// stops at 0.10 (WC_FUNDING_CONFIDENCE_RANGE), GL and Property at 0.30
// (SLIDER_RANGES). Driving all three to 0.10 would test Property at a booking
// bias the UI cannot produce, which overstates the exercise and tests nothing a
// player can reach. Same reasoning, same constants, as audit-formula-check.
// ============================================================================
const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
const ARMS: { name: string; decisions: (y: number, lines: CoverageLine[]) => DecisionSet }[] = [
  { name: 'def', decisions: y => defaultDecisionSet(y) },
  {
    name: 'sqz',
    decisions: (y, lines) => {
      const d = defaultDecisionSet(y);
      return {
        ...d,
        byLine: Object.fromEntries(lines.map(l =>
          [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
      };
    },
  },
];

const out: Record<string, number> = {};
for (const arm of ARMS) {
for (const id of SEEDS) {
  for (const { lines, name } of CONFIGS) {
    const instance = generateGameInstance(id, seedOf(id));
    const setup = { poolName: 'G', gameLength: 5, startingYear: 2026, instanceId: id, activeLines: lines };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= 5; y++) {
      const p = processYear(gs, arm.decisions(y, lines));
      const scopes: [string, ResultSet | LineResultSet][] = [
        ['pool', p.result],
        ...lines.map(l => [l, p.result.byLine[l]] as [string, LineResultSet]),
      ];
      for (const [scope, r] of scopes) {
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === 'number' && Number.isFinite(v)) out[`${arm.name}|${id}|${name}|Y${y}|${scope}|${k}`] = v;
        }
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
}
}

if (process.argv.includes('--write')) {
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 0) + '\n');
  console.log(`Captured ${Object.keys(out).length} numeric fields -> ${BASELINE}`);
  process.exit(0);
}

const base: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const baseKeys = new Set(Object.keys(base));
const nowKeys = new Set(Object.keys(out));
const added = [...nowKeys].filter(k => !baseKeys.has(k));
const removed = [...baseKeys].filter(k => !nowKeys.has(k));
const changed = [...nowKeys].filter(k => baseKeys.has(k) && base[k] !== out[k]);
// Raised by the ABSOLUTE identity check below. Kept separate from `changed` so
// the two failure modes stay distinguishable in the exit code's reason: values
// moving is one thing, an identity being untrue is another.
let identityFailures = 0;

const fieldNames = (keys: string[]) => [...new Set(keys.map(k => k.split('|').pop()!))].sort();

console.log(`fields: baseline ${baseKeys.size}, now ${nowKeys.size}`);
console.log(`\nSHAPE (informational — new or dropped fields are not a value change):`);
console.log(`  added   ${added.length}${added.length ? `  fields: ${fieldNames(added).join(', ')}` : ''}`);
console.log(`  removed ${removed.length}${removed.length ? `  fields: ${fieldNames(removed).join(', ')}` : ''}`);

console.log(`\nVALUES — THE GATE:`);
if (changed.length === 0) {
  console.log(`  0 changed. Every field present in both is bit-identical.`);
} else {
  const byField = new Map<string, string[]>();
  for (const k of changed) {
    const f = k.split('|').pop()!;
    if (!byField.has(f)) byField.set(f, []);
    byField.get(f)!.push(k);
  }
  console.log(`  ${changed.length} changed across ${byField.size} field(s):`);
  for (const [f, keys] of [...byField.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const ex = keys[0];
    console.log(`    ${f.padEnd(34)} ${String(keys.length).padStart(4)} instances   e.g. ${base[ex]} -> ${out[ex]}`);
  }

  // ==========================================================================
  // BROKEN IDENTITIES — reported SEPARATELY from ordinary movement, because
  // they are not the same kind of event and reading them as the same kind is
  // how a real defect shipped.
  //
  // ⚠ THIS RULE EXISTS BECAUSE THE GATE ALREADY CAUGHT THE BUG AND NOBODY
  // NOTICED. At the net-funding chain this script logged
  //   expectedCombinedRatio   111 instances   e.g. 1 -> 1.1734760163189506
  // in the middle of a list of 78 legitimately-moving fields, and it was read
  // as intended movement like everything around it. It was not: that field sat
  // at EXACTLY 1 on every line and every year because
  // poolPremium + admin + reinsurance is identically totalMemberCharge. A
  // field pinned to exactly 1.000 or exactly 0.000 across EVERY instance is a
  // CLOSED IDENTITY, not a value that happens to be round, and its departure
  // is a defect by construction rather than a change to be explained.
  //
  // The test is deliberately conservative — it fires only when the baseline
  // was exactly 1 or exactly 0 at EVERY instance of that field name, so a
  // quantity that is merely usually-zero (dividends, assessments, shock loss)
  // does not trip it. A field that legitimately leaves an identity will still
  // be listed here; the point is that it must be argued for explicitly rather
  // than disappearing into the ordinary list.
  // ==========================================================================
  const allByField = new Map<string, string[]>();
  for (const k of baseKeys) {
    const f = k.split('|').pop()!;
    if (!allByField.has(f)) allByField.set(f, []);
    allByField.get(f)!.push(k);
  }
  //
  // ⚠ "EXACTLY 1" MEANS TO FLOAT PRECISION, NOT BIT-EXACTLY, and that
  // distinction was nearly fatal to this rule. A closed identity evaluated by
  // SUMMING per-line terms picks up ordering noise: at the v15 measurement 6 of
  // 150 expectedCombinedRatio instances sat at 1 +/- 2e-16 rather than exactly
  // 1. A bit-exact test would therefore have refused to arm on the very field
  // this rule was written for, silently, from the first recapture onward.
  //
  // THE ASYMMETRY BETWEEN 1 AND 0 IS DELIBERATE. A value that should be 1 is a
  // RATIO — dimensionless — so 1e-12 is a meaningful scale-free bound. A value
  // that should be 0 has UNITS, so no scale-free epsilon exists for it; exact
  // is the only defensible test there and it errs toward firing, which is the
  // right direction for a guard.
  //
  // ⚠ BUT THE SAME BOUND MUST APPLY ON BOTH SIDES, and it did not. The rule
  // used 1e-12 to decide the baseline "was 1" and then STRICT INEQUALITY to
  // decide an instance had moved, so 1 -> 0.9999999999999999 counted as a break
  // of the identity. It fired that way during the TIV rescale, on pure float
  // noise, and a guard that cries wolf gets ignored — which is operationally
  // the same as a guard that cannot fire. That failure mode is the one this
  // project keeps rediscovering, and the rule had it two commits after being
  // written to prevent it.
  //
  // So `realMoved` re-tests each changed instance against the identity itself
  // rather than against its own baseline value. `changed` is still the right
  // input — it is the ordinary value gate and must stay strict — but leaving an
  // identity is a different question from moving at all.
  const IDENTITY_EPS = 1e-12;
  const broken: { field: string; was: number; moved: number; of: number; worst: number }[] = [];
  for (const [f, keys] of byField) {
    const every = allByField.get(f) ?? [];
    const wasAllOne = every.length > 0 && every.every(k => Math.abs(base[k] - 1) <= IDENTITY_EPS);
    const wasAllZero = every.length > 0 && every.every(k => base[k] === 0);
    if (!wasAllOne && !wasAllZero) continue;
    const target = wasAllOne ? 1 : 0;
    // Zero keeps its exact test, for the units reason above.
    const realMoved = wasAllOne
      ? keys.filter(k => Math.abs(out[k] - target) > IDENTITY_EPS)
      : keys.filter(k => out[k] !== target);
    if (realMoved.length === 0) continue;
    const worst = Math.max(...realMoved.map(k => Math.abs(out[k] - target)));
    broken.push({ field: f, was: target, moved: realMoved.length, of: every.length, worst });
  }
  if (broken.length > 0) {
    console.log(`\n  ⚠ BROKEN IDENTITIES — ${broken.length} field(s) left a value that was EXACTLY`);
    console.log(`  constant across every instance in the baseline. Treat each as a defect until`);
    console.log(`  argued otherwise; do NOT recapture past one without deciding it is intended.`);
    for (const b of broken) {
      const ex = byField.get(b.field)![0];
      console.log(`    ${b.field.padEnd(34)} was ${b.was} on all ${b.of} instances; ` +
        `${b.moved} left it by more than ${IDENTITY_EPS}, worst ${b.worst.toExponential(2)}, e.g. -> ${out[ex]}`);
    }
  }
}


// ============================================================================
// ABSOLUTE IDENTITY CHECK — is the identity TRUE, not merely UNMOVED?
//
// ⚠ THIS RUNS UNCONDITIONALLY, AND THAT IS THE WHOLE POINT. The BROKEN
// IDENTITIES rule above walks the CHANGED list, so it answers "did this
// depart from baseline" and can only speak when something departed. Two
// consequences, both real:
//
//   1. WHEN NOTHING CHANGES IT CANNOT FIRE, so its silence is not evidence.
//      The entire v20 -> v21 range moved 0 of 15,150 values across seven
//      commits. The relative rule was silent for all seven, and that silence
//      said nothing whatever about whether expectedCombinedRatio was still 1.
//      Verifying it by hand at the v21 recapture was the right instinct and is
//      the reason this section exists.
//
//   2. AN IDENTITY ALREADY WRONG WHEN FIRST BASELINED STAYS WRONG AND SILENT
//      FOREVER. The relative rule requires the baseline to be uniform to arm
//      at all, so a partly-broken identity is invisible to it by construction
//      — it is not in the changed list and it was never uniform.
//
// So: candidates are DETECTED from the baseline (the same uniformity test the
// relative rule uses) and then ASSERTED against the CURRENT capture, every run,
// whether or not anything moved. Case 2 is covered by the SUSPECTED PARTIAL
// section below, which looks for near-uniformity rather than uniformity.
//
// ⚠ AND BIT-EXACTNESS IS CLASSIFIED, NOT PASSED. A genuine identity computed
// two ways carries float noise: expectedCombinedRatio sums per-line terms and
// lands within 2.22e-16 of 1, never ON it. A field that is bit-exact on every
// single instance was not computed twice — it is a value minus itself, an
// inactive quantity, or a pinned constant. That is how Expense Ratio Check
// Difference was caught: exactly 0.0 on 480 of 480 scope-years, against a
// neighbour showing real 1e-16 noise on 289 of the same 480. Passing a
// tautology as a satisfied identity is the failure mode this whole file exists
// to prevent, so bit-exactness is reported separately rather than counted as a
// pass.
//
// ⚠ SCOPE LIMIT, SO THE PRECEDENT IS NOT MISREAD. This section sees RESULTSET
// FIELDS. Expense Ratio Check Difference is an AUDIT-PAGE ROW computed inside
// CalculationAuditPage, so it would never have appeared here — it is named above
// as the archetype of the pattern, not as something this check would have
// caught. Audit-page reconciliations are covered by audit-formula-check, which
// gained its own arms and prose checks for the same reason. Two files, two
// populations; neither is a substitute for the other.
// ============================================================================
{
  const IDENTITY_EPS_ABS = 1e-12;
  const byFieldAll = (keys: string[]) => {
    const m = new Map<string, string[]>();
    for (const k of keys) {
      const f = k.split('|').pop()!;
      if (!m.has(f)) m.set(f, []);
      m.get(f)!.push(k);
    }
    return m;
  };
  const baseFields = byFieldAll([...baseKeys]);
  const nowFields = byFieldAll([...nowKeys]);

  // ⚠ DETECT LOOSE, ASSERT TIGHT — and that asymmetry is what closes the "already
  // wrong when first baselined" gap. If detection used the SAME 1e-12 band as the
  // assertion, a field baselined at a uniform 1.000000001 would not be recognised
  // as an identity at all: not in the changed list (it never moves), not uniform
  // at 1 (it is uniform at 1+1e-9), and therefore silent in both rules forever.
  // Recognising it as identity-SHAPED at 1e-6 and then holding it to 1e-12 is what
  // makes that case fail instead.
  //
  // THE BAND IS ONE-SIDED ON PURPOSE. A value that should be 1 is a RATIO, so a
  // dimensionless band is meaningful. A value that should be 0 has UNITS — there
  // is no scale-free epsilon for it — so zero keeps an EXACT test on both sides,
  // the same reasoning the relative rule above already records.
  const DETECT_BAND = 1e-6;
  const shapedLikeOne = (v: number) => Math.abs(v - 1) <= DETECT_BAND;
  const nearOne = (v: number) => Math.abs(v - 1) <= IDENTITY_EPS_ABS;
  const nearZero = (v: number) => v === 0;

  type Verdict = {
    field: string; target: 0 | 1; n: number;
    violations: number; worst: number;
    bitExact: number; noisy: number;
  };
  const held: Verdict[] = [];
  const violated: Verdict[] = [];
  const tautologies: Verdict[] = [];

  for (const [f, bKeys] of baseFields) {
    // DETECTED FROM THE BASELINE — the same uniformity test the relative rule
    // applies, so the two rules agree on what an identity IS and differ only in
    // what they do about it.
    const allOne = bKeys.length > 0 && bKeys.every(k => shapedLikeOne(base[k]));
    const allZero = bKeys.length > 0 && bKeys.every(k => nearZero(base[k]));
    if (!allOne && !allZero) continue;
    const target: 0 | 1 = allOne ? 1 : 0;

    // ASSERTED AGAINST THE CURRENT CAPTURE, every instance, every run.
    const cur = nowFields.get(f) ?? [];
    if (cur.length === 0) continue;   // field removed; the shape report covers that
    const bad = cur.filter(k => target === 1 ? !nearOne(out[k]) : !nearZero(out[k]));
    const bitExact = cur.filter(k => out[k] === target).length;
    const v: Verdict = {
      field: f, target, n: cur.length,
      violations: bad.length,
      worst: bad.length ? Math.max(...bad.map(k => Math.abs(out[k] - target))) : 0,
      bitExact, noisy: cur.length - bitExact,
    };
    if (bad.length > 0) violated.push(v);
    else if (bitExact === cur.length) tautologies.push(v);
    else held.push(v);
  }

  const total = held.length + violated.length + tautologies.length;
  console.log(`\nABSOLUTE IDENTITIES — asserted every run, independent of what moved:`);
  console.log(`  ${total} field(s) detected as an identity in the baseline (uniformly 1 or uniformly 0).`);

  if (held.length) {
    console.log(`\n  HELD, computed two ways (float noise present — the signature of a real identity):`);
    for (const v of held.sort((a, b) => a.field.localeCompare(b.field))) {
      console.log(`    ${v.field.padEnd(34)} = ${v.target} on all ${String(v.n).padStart(4)} instances   ` +
        `${v.noisy} carry noise, ${v.bitExact} bit-exact`);
    }
  }

  if (tautologies.length) {
    console.log(`\n  ⚠ BIT-EXACT ON EVERY INSTANCE — reported, NOT passed as satisfied identities.`);
    console.log(`  A quantity computed two ways does not land bit-exactly every time. Each of these`);
    console.log(`  is a value minus itself, a quantity that is simply inactive, or a pinned constant`);
    console.log(`  — and only reading it says which. A reconciliation-shaped NAME on this list is the`);
    console.log(`  strong signal: that is what Expense Ratio Check Difference looked like.`);
    const looksLikeCheck = (f: string) => /Difference|Check|TieOut|tieOut/.test(f);
    const suspicious = tautologies.filter(v => looksLikeCheck(v.field));
    const inactive = tautologies.filter(v => !looksLikeCheck(v.field));
    if (suspicious.length) {
      console.log(`\n    RECONCILIATION-SHAPED (a check that may be unable to fail):`);
      for (const v of suspicious.sort((a, b) => a.field.localeCompare(b.field))) {
        console.log(`      ${v.field.padEnd(34)} = ${v.target} bit-exactly on all ${v.n} instances`);
      }
    }
    if (inactive.length) {
      console.log(`\n    NOT RECONCILIATION-SHAPED (more likely inactive or pinned, still unverified):`);
      for (const v of inactive.sort((a, b) => a.field.localeCompare(b.field))) {
        console.log(`      ${v.field.padEnd(34)} = ${v.target} bit-exactly on all ${v.n} instances`);
      }
    }
  }

  if (violated.length) {
    identityFailures += violated.length;
    console.log(`\n  ⚠ IDENTITY VIOLATED — a field the baseline holds to be exactly ${''}1 or 0 does not read it NOW.`);
    console.log(`  This fires whether or not the field moved, which is what the relative rule cannot do.`);
    for (const v of violated.sort((a, b) => b.worst - a.worst)) {
      console.log(`    ${v.field.padEnd(34)} should be ${v.target}; ${v.violations} of ${v.n} instances are not, ` +
        `worst departure ${v.worst.toExponential(2)}`);
    }
  }

  // --- CASE 2: an identity that was ALREADY WRONG when first baselined -------
  //
  // Uniformity detection cannot see this by construction, so near-uniformity is
  // the only available signal. NOT GATED: a field that is merely usually-zero
  // (dividends, assessments, shock loss at default decisions) looks identical
  // from here, and gating on it would be the cry-wolf failure this file already
  // warns about twice. Reported so a real one can be recognised.
  const NEAR = 0.90;
  const partial: { field: string; target: 0 | 1; at: number; n: number; worst: number }[] = [];
  for (const [f, cur] of nowFields) {
    if (cur.length < 10) continue;
    for (const target of [1, 0] as const) {
      const hit = cur.filter(k => target === 1 ? nearOne(out[k]) : nearZero(out[k]));
      if (hit.length === cur.length) continue;               // uniform: handled above
      if (hit.length / cur.length < NEAR) continue;          // not identity-shaped
      const off = cur.filter(k => !hit.includes(k));
      partial.push({ field: f, target, at: hit.length, n: cur.length, worst: Math.max(...off.map(k => Math.abs(out[k] - target))) });
    }
  }
  if (partial.length) {
    console.log(`\n  SUSPECTED PARTIAL IDENTITY — ${NEAR * 100}%+ of instances sit exactly on 1 or 0 and the rest`);
    console.log(`  do not. This is the shape of an identity that was ALREADY BROKEN when it was first`);
    console.log(`  baselined, which uniformity detection can never see. NOT GATED: a merely`);
    console.log(`  usually-zero quantity looks the same from here.`);
    for (const p of partial.sort((a, b) => b.at / b.n - a.at / a.n)) {
      console.log(`    ${p.field.padEnd(34)} ${p.at}/${p.n} at exactly ${p.target}, worst outlier ${p.worst.toExponential(2)}`);
    }
  } else {
    console.log(`\n  SUSPECTED PARTIAL IDENTITY: none — no field sits on 1 or 0 for ${NEAR * 100}%+ of its`);
    console.log(`  instances without doing so for all of them.`);
  }
}

// ⚠ TWO GATES, TWO QUESTIONS, AND BOTH ARE KEPT. The relative rule answers "did
// this MOVE"; the absolute one answers "is this TRUE". Neither subsumes the
// other: a range that moves nothing silences the first, and an identity broken
// before it was ever baselined is invisible to it permanently. The v20 -> v21
// range is exactly the case where only the second one speaks.
// ⚠ THE TWO VERDICTS ARE STATED SEPARATELY BECAUSE THEY CAN DISAGREE, and the
// disagreement is the interesting case: "no value moved" and "an identity is
// false" are both true at once when a broken identity was baselined. Printing an
// unqualified HOLDS above a failure line would be the report contradicting
// itself.
const movedVerdict = changed.length === 0
  ? `VALUES UNMOVED${added.length || removed.length ? ' (shape changed — expected for a display-layer fix)' : ''}`
  : 'VALUES MOVED — if this was meant to be a display-only change, it was not one';
if (identityFailures > 0) {
  console.log(`\n${movedVerdict}, BUT ${identityFailures} ABSOLUTE IDENTITY FAILURE(S):`);
  console.log(`a field that must read exactly 1 or 0 does not. An unmoved wrong value is still`);
  console.log(`wrong — this is precisely what the relative rule cannot report.`);
} else if (changed.length === 0) {
  console.log(`\nVALUE IDENTITY HOLDS${added.length || removed.length ? ' (shape changed — expected for a display-layer fix)' : ''}.`);
} else {
  console.log(`\n${movedVerdict}.`);
}
process.exitCode = (changed.length === 0 && identityFailures === 0) ? 0 : 1;
