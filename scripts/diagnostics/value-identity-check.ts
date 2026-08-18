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
import type { CoverageLine, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';

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
const BASELINE = path.join(__dirname, '../../baselines/VALUE_IDENTITY_v12.json');

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

const out: Record<string, number> = {};
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
      const p = processYear(gs, defaultDecisionSet(y));
      const scopes: [string, ResultSet | LineResultSet][] = [
        ['pool', p.result],
        ...lines.map(l => [l, p.result.byLine[l]] as [string, LineResultSet]),
      ];
      for (const [scope, r] of scopes) {
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === 'number' && Number.isFinite(v)) out[`${id}|${name}|Y${y}|${scope}|${k}`] = v;
        }
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
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
}

if (changed.length === 0) {
  console.log(`\nVALUE IDENTITY HOLDS${added.length || removed.length ? ' (shape changed — expected for a display-layer fix)' : ''}.`);
} else {
  console.log(`\nVALUES MOVED — if this was meant to be a display-only change, it was not one.`);
}
process.exitCode = changed.length === 0 ? 0 : 1;
