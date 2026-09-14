// ============================================================================
// THE PRIVACY SURFACE — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/surface-privacy-check.ts
//
// Risk quality is UNOBSERVABLE. A pool administrator sees a member's claims,
// their payroll and their renewal behaviour; they do not see a 1-10 score of
// how well the entity is run. The simulation keeps the attribute — the claim
// engines read it, member movement reads it (see membershipEngine.ts's note
// at the sort) — and the PLAYER does not.
//
// ============================================================================
// WHY A GATE AND NOT A CODE REVIEW.
//
// Hiding an attribute is a one-commit act and keeping it hidden is not. The
// field is still on Member, still populated, still used by four engines, and
// `member.riskQuality` will keep compiling forever. The next page that wants
// "a quality indicator" will find it in autocomplete, and nothing but this
// file will object.
//
// THE ELEVEN SITES THIS WAS BUILT FROM, as they stood at the hide:
//
//   MembershipPage      sort-key union, sort comparator, column header,
//                       quality colour, the cell itself                (5)
//   ResultSpreadsheet   member-table column header, table cell,
//                       CSV header, CSV cell                           (4)
//   MembershipPage:78   pool AVERAGE — kept                            (1)
//   ResultsPage:285     pool AVERAGE — kept                            (1)
//
// Nine removed, two kept. The two kept are averages over ~60 members, which
// leak almost nothing about any individual, and CalculationAuditPage's
// formula notes are kept for the same class of reason — that page documents
// the model to whoever is auditing it, and describes the STARTING_FINANCIALS
// range rather than any member.
//
// ============================================================================
// WHAT COUNTS AS PLAYER-FACING, AND WHY THE ALLOWLIST IS BY EXPRESSION.
//
// Scanned: src/pages and src/components — every render path — plus the export
// builders in src/utils that those pages call. NOT scanned: the engines,
// which must read the attribute to simulate it.
//
// The allowlist matches whole EXPRESSIONS, not files. Allowing a file would
// mean the next `member.riskQuality` added to MembershipPage passes silently,
// which is precisely the regression this exists to catch. Allowing
// `averageRiskQuality` and refusing `member.riskQuality` is the distinction
// that carries the ruling: an average is a pool statistic, a per-member read
// is the attribute.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE MATCHING, because a comment cannot render.
// This file's own subject matter means the surfaces it guards are full of
// comments EXPLAINING the absence of risk quality, and a gate that counted
// its own justification as a violation would be unusable. Commented-out
// markup is not a leak either — it starts leaking on the commit that
// uncomments it, and that commit is the one this catches.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../../src');
const RULE = '='.repeat(76);

/** Directories whose contents render to, or export for, the player. */
const SURFACES = ['pages', 'components'];
/** Export builders that pages call — a CSV is a player-facing surface. */
const EXPORT_BUILDERS = ['utils/resultsExport.ts', 'utils/resultMetrics.ts', 'utils/claimsWorkbook.ts'];

/**
 * Expressions that may mention risk quality on a player-facing surface.
 *
 * ⚠ EVERY ENTRY IS A POOL-LEVEL AGGREGATE OR A MODEL NOTE. Adding a
 * per-member expression here is not a config change, it is a reversal of the
 * ruling, and it should be argued in a commit message rather than in a
 * string array.
 */
const ALLOWED: { expr: string; why: string }[] = [
  { expr: 'averageRiskQuality', why: 'pool average over ~60 members; leaks almost nothing about any individual' },
  { expr: 'Avg. Risk Quality', why: 'the label on that average' },
  { expr: 'Average Risk Quality', why: 'the same average, in export/audit prose' },
  { expr: 'STARTING_FINANCIALS.riskQuality', why: 'CalculationAuditPage documents the opening RANGE, not a member' },
  { expr: 'startingFinancials.riskQuality', why: 'the opening pool average, same reason' },
  { expr: 'risk quality', why: 'prose in model documentation on the audit page' },
  { expr: 'Risk quality changes standard deviation', why: 'CalculationAuditPage note on the Gamma member-loss draw — a statement about the MODEL, naming no member' },
];

const failures: string[] = [];

/** Line comments, trailing comments and block-comment bodies removed. A
 *  comment cannot render, so it cannot leak. */
function stripComments(line: string): string {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files: string[] = [];
for (const s of SURFACES) {
  const d = path.join(SRC, s);
  if (fs.existsSync(d)) walk(d, files);
}
for (const f of EXPORT_BUILDERS) {
  const p = path.join(SRC, f);
  if (fs.existsSync(p)) files.push(p);
}

console.log(RULE);
console.log('THE PRIVACY SURFACE: risk quality is not shown to the player');
console.log(RULE);
console.log(`scanning ${files.length} files under ${SURFACES.map(s => `src/${s}`).join(', ')} `
  + `plus ${EXPORT_BUILDERS.length} export builders\n`);

let hits = 0, allowedHits = 0;
const offenders: string[] = [];
const allowedBy: Record<string, number> = {};

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = stripComments(line);
    if (!/riskQuality|[Rr]isk [Qq]uality/.test(code)) return;
    hits++;
    // ⚠ EVERY MATCHING ENTRY IS CREDITED, NOT JUST THE FIRST. One line can
    // satisfy two: MembershipPage's `last?.averageRiskQuality ??
    // startingFinancials.riskQuality` contains both. Crediting only the first
    // left the second reading as dead permission and the rot check fired on
    // a live site — the rot check catching a bug in the rot check.
    const matched = ALLOWED.filter(a => code.includes(a.expr));
    if (matched.length > 0) {
      allowedHits++;
      for (const a of matched) allowedBy[a.expr] = (allowedBy[a.expr] ?? 0) + 1;
      return;
    }
    const rel = path.relative(path.join(__dirname, '../..'), file);
    offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
  });
}

console.log(`  ${hits} mentions found, ${allowedHits} allowed, ${offenders.length} not allowed`);
for (const a of ALLOWED) {
  const n = allowedBy[a.expr] ?? 0;
  console.log(`    ${n > 0 ? String(n).padStart(2) : ' -'}  ${a.expr.padEnd(30)} ${a.why}`);
}

if (offenders.length > 0) {
  console.log('\n  NOT ALLOWED:');
  for (const o of offenders) console.log(`    ${o}`);
  failures.push(`${offenders.length} player-facing mention(s) of risk quality. The attribute is `
    + 'UNOBSERVABLE: a pool administrator sees claims, payroll and renewals, not a 1-10 score of how '
    + 'well an entity is run. If this is a pool-level AGGREGATE, add the expression to ALLOWED with its '
    + 'reason. If it is per-member, it reverses a ruling and needs a commit message, not an allowlist '
    + 'entry — the experience modifier on MembershipPage is the intended per-member indicator.');
}

// ⚠ THE ALLOWLIST IS CHECKED FOR ROT, BOTH WAYS. An entry that matches
// nothing is either a site that moved or a rule nobody needs, and either way
// it is quietly widening the gate; an allowlist that only ever grows stops
// being a list of exceptions and becomes a list of excuses.
const dead = ALLOWED.filter(a => !(allowedBy[a.expr] > 0));
console.log(`\n  allowlist entries matching nothing: ${dead.length}  (must be 0)`);
for (const d of dead) console.log(`    ${d.expr}`);
if (dead.length > 0) {
  failures.push(`${dead.length} allowlist entr${dead.length === 1 ? 'y matches' : 'ies match'} nothing: `
    + `${dead.map(d => d.expr).join(', ')}. Either the site moved and the entry needs re-pointing, or the `
    + 'site is gone and the entry is dead permission. An allowlist that outlives its sites widens silently.');
}

// ⚠ POSITIVE CONTROL: the matcher must REJECT a realistic leak. "0 not
// allowed" is only meaningful if the classifier can say no, and the way this
// gate fails is by being quietly too permissive — a broadened allowlist
// entry, or a `code.includes` that matches more than intended. So the exact
// lines that were REMOVED at the hide are run back through it.
{
  const LEAKS = [
    `      <td className={\`px-4 py-3 font-semibold \${qualityColor}\`}>{member.riskQuality.toFixed(1)}</td>`,
    `          member.riskQuality,`,
    `      safeNumber(record.riskQuality),`,
    `        riskQuality: safeNumber(record.riskQuality),`,
    `    else if (sortKey === 'riskQuality') { valA = a.riskQuality; valB = b.riskQuality; }`,
    `    return 'Member ID,Name,Payroll Exposure ($M),Risk Quality,Satisfaction';`,
  ];
  let caught = 0;
  for (const leak of LEAKS) {
    const code = stripComments(leak);
    const seen = /riskQuality|[Rr]isk [Qq]uality/.test(code);
    const allowed = ALLOWED.some(a => code.includes(a.expr));
    if (seen && !allowed) caught++;
  }
  console.log(`  POSITIVE CONTROL: ${caught}/${LEAKS.length} of the lines removed at the hide are still `
    + `rejected   ${caught === LEAKS.length ? 'PASS' : 'FAIL'}`);
  if (caught !== LEAKS.length) {
    failures.push(`the matcher accepted ${LEAKS.length - caught} of ${LEAKS.length} lines that were REMOVED `
      + 'at the hide — real per-member risk-quality renders and export cells. The allowlist has been '
      + 'broadened until it permits the thing it exists to forbid, so "0 not allowed" above means nothing. '
      + 'Narrow the entry that now matches these.');
  }
}

// ===========================================================================
// THE EXPERIENCE-RATIO PATH — a second surface, and it needed asserting rather
// than assuming.
//
// MembershipPage now renders a LOSS RATIO column per member, and Renewal
// Underwriting thresholds on it. The ratio is actual primary loss over the
// member's own expected primary loss, so it is derived from THEIR OWN CLAIMS —
// an observable a pool administrator genuinely has — and not from the hidden
// attribute. That is the claim. This asserts it.
//
// ⚠ THE PROPERTY THAT MAKES IT TRUE IS ONE LINE OF ARITHMETIC AND IT IS EASY TO
// LOSE. `expectedAtManual` is the expectation with RISK QUALITY ALONE OVERRIDDEN
// TO NEUTRAL (memberLossHistory.ts states it). primaryShare does the same on the
// other leg. So neither leg of the ratio carries the member's own score, and
// what survives is how their realized claims compared with a neutral member of
// their class. Drop the override — write `member.riskQuality` where
// `riskQualityOverride: NEUTRAL_RQ` stands, or pass the member's own value —
// and the denominator starts absorbing the attribute. The ratio would still
// LOOK like a claims statistic while having become a partial readout of the
// score, and the column would be showing the player exactly what the ruling
// hides.
//
// It would also be invisible to the scan above, because memberExperienceMod.ts
// is a util and not a surface. So the assertion is here: in the ratio's own
// module, EVERY mention of risk quality must be a neutral override.
// ===========================================================================
{
  // ⚠ TWO MODULES, BECAUSE THE RATIO NOW FEEDS TWO DECISIONS. memberExperienceMod
  // computes it; newBusinessAppetite thresholds APPLICANTS on it. A prospect's
  // ratio has to be computed at neutral risk quality on both legs for exactly
  // the reason a member's does — more so, in fact, since an applicant is chosen
  // ON that number rather than merely billed by it. newBusinessAppetite gets
  // its ratio by delegating to memberExperienceMods, so today it inherits the
  // property; it is listed here so that the day someone computes a prospect
  // ratio locally instead, the gate is already watching the file they will
  // write it in.
  const RATIO_MODULES = ['utils/memberExperienceMod.ts', 'utils/newBusinessAppetite.ts'];
  for (const RATIO_MODULE of RATIO_MODULES) {
  const p = path.join(SRC, RATIO_MODULE);
  console.log('');
  if (!fs.existsSync(p)) {
    failures.push(`${RATIO_MODULE} is missing — the experience-ratio assertion below cannot run, `
      + 'and it is the only thing standing between the Loss Ratio column and the hidden attribute.');
  } else {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    /** A mention is clean only if risk quality enters as an explicit neutral
     *  override. Anything else — a bare read, or an override of something that
     *  is not NEUTRAL_RQ — is the defect. */
    const NEUTRAL = /riskQualityOverride:\s*[A-Z_]*NEUTRAL_RQ\b/;
    const MENTION = /riskQuality|NEUTRAL_RQ/;
    let clean = 0;
    const dirty: string[] = [];
    lines.forEach((raw, i) => {
      const code = stripComments(raw);
      if (!MENTION.test(code)) return;
      // An import of the neutral constant is how it gets here at all.
      if (/^\s*import\b/.test(code) && /NEUTRAL_RQ/.test(code)) { clean++; return; }
      if (NEUTRAL.test(code)) { clean++; return; }
      dirty.push(`${RATIO_MODULE}:${i + 1}  ${code.trim()}`);
    });
    console.log(`  experience-ratio path: ${clean} risk-quality mention(s) in ${RATIO_MODULE}, `
      + `all neutral overrides   ${dirty.length === 0 ? 'PASS' : 'FAIL'}`);
    for (const d of dirty) console.log(`      ${d}`);
    if (dirty.length > 0) {
      failures.push(`${RATIO_MODULE} reads risk quality somewhere other than as a neutral override `
        + `(${dirty.length} site(s), listed above). Both legs of the experience ratio must be computed `
        + 'at NEUTRAL risk quality, or the ratio stops being "what this member cost against a neutral '
        + 'member of their class" and starts encoding the member\'s own hidden score — which the '
        + 'Loss Ratio column on MembershipPage then renders, and Renewal Underwriting then acts on.');
    }
    // ⚠ CONTROLLED THE SAME WAY THE SCAN ABOVE IS, BUT ONLY WHERE THE OVERRIDES
    // SHOULD EXIST. memberExperienceMod is where the expectation is computed, so
    // zero mentions there means the neutral basis is gone and the assertion
    // above is passing on nothing — the inert-probe failure wearing a green
    // tick. newBusinessAppetite DELEGATES and is expected to have none, so the
    // same control there would fail a correct file.
    const RATIO_CONTROL_MIN = RATIO_MODULE.includes('memberExperienceMod') ? 4 : 0;
    const ratioSane = clean >= RATIO_CONTROL_MIN;
    console.log(`  probe control: ${clean} neutral-override mention(s) found `
      + `(>= ${RATIO_CONTROL_MIN})   ${ratioSane ? 'PASS' : 'FAIL'}`);
    if (!ratioSane) {
      failures.push(`only ${clean} neutral-override mention(s) found in ${RATIO_MODULE} — the assertion `
        + 'above passes trivially when there is nothing to check. Either the expectation is no longer '
        + 'computed at neutral risk quality, or this check is looking at the wrong module.');
    }
  }
  }
}

// ⚠ AND THE SCAN ITSELF IS CONTROLLED. If the directories moved or the glob
// broke, every assertion above would pass on zero files and read as green —
// the inert-probe failure this project has a named rule about.
const CONTROL_MIN_FILES = 15;
const sane = files.length >= CONTROL_MIN_FILES && hits > 0;
console.log(`  probe control: ${files.length} files scanned (>= ${CONTROL_MIN_FILES}) and ${hits} mentions `
  + `found (> 0)   ${sane ? 'PASS' : 'FAIL'}`);
if (!sane) {
  failures.push(`the scan found ${files.length} files and ${hits} mentions — it is not looking at the code. `
    + 'Every assertion above passes trivially on an empty scan, so this control is what makes them mean '
    + 'anything. Check SURFACES and EXPORT_BUILDERS against the actual tree.');
}

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('RISK QUALITY REACHES NO PLAYER-FACING RENDER OR EXPORT PATH. THE POOL-LEVEL');
  console.log('AVERAGES AND THE AUDIT PAGE\'S MODEL NOTES ARE THE ONLY MENTIONS, EACH ALLOWED');
  console.log('BY EXPRESSION AND EACH STILL MATCHING A REAL SITE.');
  console.log(RULE);
}
