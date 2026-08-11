// EXPORT SHAPE GUARD — did the export's SHAPE change?
//
// Plays full 5-year games in four line configurations (WC-solo, GL-solo,
// Property-solo, and all three together) across three seeds, exports each
// through the real results workbook, and SHA-256s the PARSED CELL DATA rather
// than the .xlsx wrapper — the wrapper carries timestamps and zip ordering
// that change without the numbers changing, so hashing it would be noise.
//
// ============================================================================
// THIS IS THE SHAPE CHECK, NOT THE VALUE CHECK. Read the same block in
// value-identity-check.ts before "improving" either.
//
// The hash covers VALUES, LABELS, ROW SET AND ORDERING all at once, so it
// cannot say WHICH of them moved. That makes it:
//   - excellent at catching an unintended reorder, a dropped row, or a
//     restructure leaking into another line's math;
//   - useless as a display-layer gate, because renaming a label or adding a
//     metric turns it red by construction while nothing computed has changed.
//
// Its companion, value-identity-check.ts, keys on FIELD NAME and is therefore
// label- and order-independent: it answers "did any VALUE move?" and is the
// PRIMARY gate for display-layer work. Expected pattern for a display fix:
// GREEN there, RED here. For an engine regression: RED there.
//
// Concretely: the expected-combined-ratio fix corrected two exported metrics,
// added one and renamed six labels. All 12 hashes here moved — as they had to —
// while value-identity confirmed 14,400 fields bit-identical. Do NOT re-hash a
// red guard here without first confirming value-identity is green.
// ============================================================================
//
// Purpose: when a change is supposed to touch only one line, the other lines'
// solo hashes must not move. That is the strongest available proof a
// restructure did not leak into the math (see docs/WORKING_PRACTICES.md,
// "Baseline-neutrality is the strongest test for a structural change").
//
//   npx tsx scripts/diagnostics/solo-export-guard.ts            # compare to baseline
//   npx tsx scripts/diagnostics/solo-export-guard.ts --write    # re-capture baseline
//
// Baseline: baselines/SOLO_EXPORT_GUARD_v6.json. v5 was retired by TWO changes
// landing together, and the order matters for reading the movement:
//
//   1. PER-MEMBER RNG STREAMS. Member-level streams moved from one stream per
//      purpose per year (consumed in member order) to one keyed per member, so
//      a member's claims stop depending on who else is enrolled. On its own
//      this reset WC-solo, GL-solo and tri on all three seeds and left PR-solo
//      BYTE-IDENTICAL — Property is not on the claim-generator path, so that
//      invariance was an ASSERTION that no WC/GL stream had leaked into it, and
//      it held.
//   2. THE deriveSubRng FINALIZER (fmix32), which change 1 proved necessary —
//      see finding 26. This one changes seed derivation for EVERY label, so it
//      necessarily moves Property too, including its legacy aggregate path.
//      PR-solo therefore DOES differ from v5 in this baseline. That is expected
//      and is not a leak: the leak check is the one in step 1, and the standing
//      per-key dispersion regression test now guards the finalizer.
//
// See scripts/diagnostics/enrolment-independence-check.ts for both.
//
// STAYED AT v6 THROUGH THE MARKETPLACE-WIDE GENERATION CHANGE. That change
// generates claims for all 200 members, but per-member stream keying keeps every
// enrolled draw identical and prospect losses never reach an exported figure, so
// all 12 hashes were byte-identical. value-identity moved to v7 only to absorb 60
// new kLineApplied fields, which are not exported. Recapturing here would have
// written a duplicate file under a new name, so that version skew was deliberate.
//
// v7 retired here (moved to v8) by CLF-ONLY PRICING: the Rate Change decision
// was deleted (removes an exported field on every line — a real shape change)
// and the funding-confidence-level default moved 0.75 -> 0.60 (a real value
// change on every remaining pricing/surplus/membership figure — confirmed by
// isolation test in value-identity-check.ts's header). All 12 hashes moved.
//
// v8 retired here (moved to v9) by two corrections to that same work, each
// isolated separately in value-identity-check.ts's header: the
// fundingConfidenceLevel satisfaction term neutralised (it had gone live and
// backwards at the new 0.60 default) and FUNDING_CLF_TABLE[0.60] aligned to
// the reference chart's 1.000 (was 1.003). Both touch every line via the
// shared membershipEngine.ts / lookupCLF paths, so all 12 hashes moved again,
// PR-solo included — expected here, unlike the per-member-stream work above
// where PR-solo staying still was the specific leak check.
//
// v4 was retired by roster v4
// (TIV-only rescale, see roster_canonical_v4.csv), and v3 before that by the
// expected-combined-ratio fix, which added one exported metric, corrected two
// values and renamed six labels — a legitimate export-shape change with no
// engine movement behind it (proven by value-identity-check).
//
// Baselines are RETIRED at every roster version — v2 moved payroll, TIV and
// Region; v3 decorrelated risk quality from member type and added the
// Locations / Primary Asset Share columns; v4 rescaled TIV per member type
// (total $6,993.3M -> $14,303.5M) to fix an insured-value plausibility
// failure, touching NO other column. Every Property-derived number
// legitimately changed each time, so no earlier-version hash can ever match
// again. WC and GL are the control: value-identity-check confirms their
// solo-game fields never move across any of these roster revisions, because
// neither line's generator reads TIV.
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { buildResultsWorkbook } from '../../src/utils/resultsExport';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import type { GameState, CoverageLine, ResultSet } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(__dirname, '../../baselines/SOLO_EXPORT_GUARD_v9.json');

function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function play(id: string, lines: CoverageLine[], years: number): ResultSet[] {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'G', gameLength: years, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return gs.lockedResults;
}

const SEEDS = ['MAMC6EA4', '6KA6WGLJ', 'ZZTEST99'];
const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];

const out: Record<string, string> = {};
for (const id of SEEDS) {
  for (const { lines, name } of CONFIGS) {
    const wb = buildResultsWorkbook(play(id, lines, 5), lines, RESULT_METRICS);
    const csv = wb.SheetNames.map(s => XLSX.utils.sheet_to_csv(wb.Sheets[s])).join('\n#SHEET#\n');
    out[`${id}|${name}`] = sha(Buffer.from(csv, 'utf8'));
  }
}

if (process.argv.includes('--write')) {
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log(`Captured ${Object.keys(out).length} hashes -> ${BASELINE}`);
  for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(22)} ${v.slice(0, 16)}`);
} else {
  const base: Record<string, string> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  let diffs = 0;
  for (const k of Object.keys(out)) {
    const match = base[k] === out[k];
    if (!match) diffs++;
    console.log(`  ${k.padEnd(22)} ${match ? 'MATCH' : `DIFF  baseline ${String(base[k]).slice(0, 12)} != now ${out[k].slice(0, 12)}`}`);
  }
  console.log(diffs === 0
    ? `\nALL ${Object.keys(out).length} EXPORTS BYTE-IDENTICAL TO BASELINE.`
    : `\n${diffs} EXPORT(S) CHANGED — intended? If yes, re-run with --write.`);
  process.exitCode = diffs === 0 ? 0 : 1;
}
