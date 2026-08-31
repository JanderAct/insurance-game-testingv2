// DOES THE LIVE CATALOG STILL MATCH ITS SOURCE CSV?
//
// Run: npx tsx scripts/diagnostics/roster-catalog-check.ts
//
// ============================================================================
// WHY THIS EXISTS. src/data/memberCatalog.ts is a GENERATED file that says so
// in its own header — and it had been hand-edited anyway, twice, by different
// changes months apart. Nothing checked. The drift was found only because a
// TIV rescale used "regenerate and diff" as a null test and the null test
// failed; had that rescale been done by hand-editing alone, as the previous
// one was, the divergence would still be invisible.
//
// The failure mode is specific and nasty: the generator does not warn when it
// disagrees with the catalog, it simply OVERWRITES. One of the drifted items
// was `wcRatingGroup`, which wcClaimEngine.ts reads and THROWS on — so
// regenerating would not have degraded WC, it would have stopped it.
//
// TWO QUESTIONS, AND SECTION 0 IS THE STRONGER ONE.
//
//   0. Does the live catalog equal WHAT THE GENERATOR PRODUCES TODAY?
//   1-4. Does the live catalog agree with the CSV on every AUTHORED field?
//
// ⚠ SECTION 1 CANNOT SUBSTITUTE FOR SECTION 0, and assuming it could was a real
// mistake in this file's first version. The generator does not merely copy the
// CSV — it applies DERIVED rules (risk-quality clamping, size bucketing,
// satisfaction, wcRatingGroup). Change one of those and the CSV still agrees
// with the catalog perfectly, because neither side moved; only the rule did.
//
// Demonstrated rather than argued: moving the size-bucket boundary from rank
// < 30 to rank < 31 reclassifies a member Medium -> Large, the generator emits
// the change, and sections 1-4 PASS. Section 0 catches it, because a
// byte-for-byte comparison against regenerated output has no blind spot by
// construction.
//
// Section 1 still earns its place: it is the finer-grained answer. Section 0
// says "these files differ"; sections 1-4 say WHICH member and WHICH field, and
// they hold even if the generator itself is wrong, since the CSV is the
// authored source and the generator is not.
// ============================================================================
//
// ⚠ SECTIONS 1-4 CHECK THE CSV's FIELDS, NOT THE CATALOG's. The catalog carries
// derived attributes the CSV has no column for — size bucket, satisfaction,
// wcRatingGroup — and comparing those against the CSV is impossible; comparing
// them against the generator is section 0's job. So sections 1-4 own the
// boundary (every AUTHORED value survives the crossing unchanged) and check the
// derived attributes for PRESENCE only, because absence is what a stale
// generator causes.
//
// Together: section 0 catches drift in the DERIVATION and in the STRUCTURE,
// sections 1-4 catch drift in the DATA and localise any failure to a member and
// a field.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getPredefinedMarketMembers, CANONICAL_ROSTER } from '../../src/data/memberCatalog';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Deliberately duplicated from the generator rather than imported: if the
// generator is ever pointed at a different CSV, this check must NOT follow it
// silently — a roster swap should surface here as a mismatch, not be absorbed.
const CSV_PATH = path.join(__dirname, '../../src/data/roster_canonical_v6.csv');

// ⚠ THE VERDICT NAMES WHAT FAILED. IT USED TO COUNT. A bare "N CHECK(S) FAILED"
// at the end of a long report makes the reader scroll back for the FAIL lines,
// and whatever prose they land on on the way gets read as the explanation. That
// is not hypothetical: this project misdiagnosed a red gate exactly that way,
// attributing a failure in one section to a paragraph in another that happened
// to say "is NOT a defect". `failed` exists so the last line of output is the
// list, not the count.
const failed: string[] = [];
// The verdict is fenced so no neighbouring paragraph can be read as covering it.
const RULE = '='.repeat(72);
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) {
    failures++;
    failed.push(`${label}${detail ? '  — ' + detail : ''}`);
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  } else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

console.log('=== ROSTER CSV vs GENERATED CATALOG ===\n');
console.log(`  source: ${path.basename(CSV_PATH)}\n`);

const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/\r/g, '').trim().split('\n');
const hdr = raw[0].split(',');
const col = (name: string) => {
  const i = hdr.indexOf(name);
  if (i < 0) throw new Error(`CSV has no column '${name}'`);
  return i;
};
const iId = col('ID'), iName = col('Name'), iType = col('Type'), iRegion = col('Region');
const iPayroll = col('Payroll ($M)'), iRq = col('Risk Quality'), iTiv = col('TIV ($M)');
const iLoc = col('Locations'), iShare = col('Primary Asset Share');

interface CsvRow {
  id: string; name: string; type: string; region: string;
  payroll: number; rq: number; tiv: number; locations: number; share: number;
}
const csv = new Map<string, CsvRow>();
for (const line of raw.slice(1)) {
  const c = line.split(',');
  csv.set(c[iId], {
    id: c[iId], name: c[iName], type: c[iType], region: c[iRegion],
    payroll: +c[iPayroll], rq: +c[iRq], tiv: +c[iTiv],
    locations: +c[iLoc], share: +c[iShare],
  });
}

// --- 0. THE LIVE CATALOG vs WHAT THE GENERATOR PRODUCES NOW ------------------
//
// THE CHECK THAT HAS NO BLIND SPOT. Everything below compares the catalog to
// the CSV, which by construction cannot see a change in a DERIVED rule. This
// regenerates to a scratch path and compares bytes.
//
// It is also the precondition the generator's own header states before anyone
// runs it for real: regenerate against an unchanged CSV, confirm no diff. That
// instruction was previously a request; this makes it a gate.
console.log('--- 0. LIVE CATALOG === GENERATOR OUTPUT (byte-for-byte) ---');
{
  const gen = path.join(__dirname, '../tools/generate-member-catalog.ts');
  const live = path.join(__dirname, '../../src/data/memberCatalog.ts');
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rostercheck-')), 'memberCatalog.ts');
  let ran = true;
  try {
    // CATALOG_OUT redirects the write, so the live file is never at risk even
    // if this check is run on a dirty tree.
    execFileSync('npx', ['tsx', gen], { env: { ...process.env, CATALOG_OUT: scratch }, stdio: 'pipe' });
  } catch (e) {
    ran = false;
    // A THROW IS A RESULT, NOT AN ERROR TO SWALLOW. The generator asserts its
    // roster totals, so it refuses to emit for the wrong CSV — which is how a
    // whole wrong-roster catalog was avoided once already.
    const msg = (e as { stderr?: Buffer; message?: string }).stderr?.toString() ?? (e as Error).message;
    check(false, 'the generator runs at all', msg.split('\n').find(l => l.includes('Error')) ?? 'see stderr');
  }
  if (ran) {
    const a = fs.readFileSync(live, 'utf8');
    const b = fs.readFileSync(scratch, 'utf8');
    if (a === b) {
      check(true, 'regenerating reproduces the live catalog exactly', `${a.length.toLocaleString()} bytes`);
    } else {
      const al = a.split('\n'), bl = b.split('\n');
      const diffs: string[] = [];
      for (let i = 0; i < Math.max(al.length, bl.length) && diffs.length < 6; i++) {
        if (al[i] !== bl[i]) diffs.push(`line ${i + 1}:\n        live: ${(al[i] ?? '(absent)').slice(0, 110)}\n        gen:  ${(bl[i] ?? '(absent)').slice(0, 110)}`);
      }
      check(false, 'regenerating reproduces the live catalog exactly',
        `${al.length} vs ${bl.length} lines`);
      for (const d of diffs) console.log(`        ${d}`);
      console.log('\n        ⚠ THE CATALOG AND ITS GENERATOR HAVE DIVERGED. Do NOT run the');
      console.log('        generator to "fix" this until you know which side is right — it');
      console.log('        overwrites without warning, and it has silently dropped a field');
      console.log('        that wcClaimEngine throws on before.');
    }
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  }
}

// --- 1. THE ROSTER LITERAL, WHICH IS WHAT THE GENERATOR WRITES ---------------
console.log('\n--- 1. CANONICAL_ROSTER vs CSV, field by field ---');
check(CANONICAL_ROSTER.length === csv.size,
  'same member count', `${CANONICAL_ROSTER.length} catalog vs ${csv.size} CSV`);
{
  const mismatches: string[] = [];
  const seen = new Set<string>();
  for (const row of CANONICAL_ROSTER) {
    seen.add(row.id);
    const c = csv.get(row.id);
    if (!c) { mismatches.push(`${row.id}: in catalog, absent from CSV`); continue; }
    // ⚠ EXACT COMPARISON ON THE NUMERICS, not a tolerance. Both sides are
    // decimal literals transcribed from the same source; anything other than
    // equality means a transcription error, and a tolerance would hide it.
    if (row.name !== c.name) mismatches.push(`${row.id} name: '${row.name}' vs '${c.name}'`);
    if (row.type !== c.type) mismatches.push(`${row.id} type: '${row.type}' vs '${c.type}'`);
    if (row.region !== c.region) mismatches.push(`${row.id} region: '${row.region}' vs '${c.region}'`);
    if (row.payroll !== c.payroll) mismatches.push(`${row.id} payroll: ${row.payroll} vs ${c.payroll}`);
    if (row.tiv !== c.tiv) mismatches.push(`${row.id} TIV: ${row.tiv} vs ${c.tiv}`);
    if (row.locations !== c.locations) mismatches.push(`${row.id} locations: ${row.locations} vs ${c.locations}`);
    if (row.primaryAssetShare !== c.share) mismatches.push(`${row.id} share: ${row.primaryAssetShare} vs ${c.share}`);
    // Risk quality is CLAMPED to [1, 10] by the generator, so the catalog may
    // legitimately differ from the CSV where the source is out of range. The
    // clamp is the only permitted transform, and it is asserted as such.
    const clamped = Math.max(1, Math.min(10, c.rq));
    if (row.riskQuality !== clamped) {
      mismatches.push(`${row.id} riskQuality: ${row.riskQuality} vs clamp(${c.rq}) = ${clamped}`);
    }
  }
  for (const id of csv.keys()) if (!seen.has(id)) mismatches.push(`${id}: in CSV, absent from catalog`);
  check(mismatches.length === 0, 'every authored field matches on every member',
    mismatches.length ? `${mismatches.length} mismatch(es)` : `${CANONICAL_ROSTER.length} members x 8 fields`);
  for (const m of mismatches.slice(0, 12)) console.log(`        ${m}`);
}

// --- 2. THE EXPOSURE MAPPING ------------------------------------------------
console.log('\n--- 2. THE EXPOSURE MAPPING THE ENGINE ACTUALLY READS ---');
console.log('  CANONICAL_ROSTER is the literal; exposureByLine is what every engine reads.');
console.log('  A correct literal wired to the wrong line would pass section 1 and fail here.\n');
{
  const members = getPredefinedMarketMembers();
  let badP = 0, badW = 0, badG = 0;
  for (const m of members) {
    const c = csv.get(m.id)!;
    if ((m.exposureByLine.Property ?? 0) !== c.tiv) badP++;
    if ((m.exposureByLine.WC ?? 0) !== c.payroll) badW++;
    if ((m.exposureByLine.GL ?? 0) !== c.payroll) badG++;
  }
  check(badP === 0, 'exposureByLine.Property === CSV TIV on every member', `${badP} bad`);
  check(badW === 0, 'exposureByLine.WC === CSV payroll on every member', `${badW} bad`);
  check(badG === 0, 'exposureByLine.GL === CSV payroll on every member', `${badG} bad`);
}

// --- 3. THE DERIVED ATTRIBUTES EXIST ----------------------------------------
console.log('\n--- 3. DERIVED ATTRIBUTES THE CSV DOES NOT CARRY ---');
console.log('  Not checked for VALUE — that would assert the generator against itself.');
console.log('  Checked for PRESENCE, because their absence is what a stale generator causes.\n');
{
  const members = getPredefinedMarketMembers();
  const noGroup = members.filter(m => !m.wcRatingGroup);
  // ⚠ THE ONE THAT ACTUALLY BROKE. wcRatingGroup is derived from (type, name)
  // — NOT from type alone, which is why it looks like it should be stored:
  // WC_CLASS_MIX gave every city the same safety share, so no rule over Type
  // could separate the eight cities running their own police and fire.
  // (type, name) does separate them, via WC_HIGH_SAFETY_CITIES, so it is
  // genuinely DERIVED and belongs in the generator, not in a CSV column.
  // wcClaimEngine THROWS on a member without one.
  check(noGroup.length === 0, 'every member carries wcRatingGroup (wcClaimEngine throws without it)',
    noGroup.length ? `${noGroup.length} missing, e.g. ${noGroup[0].id}` : `${members.length} members`);
  const noSize = members.filter(m => !m.sizeCategory).length;
  check(noSize === 0, 'every member carries a size bucket', `${noSize} missing`);
}

// --- 4. TOTALS --------------------------------------------------------------
console.log('\n--- 4. TOTALS ---');
{
  const members = getPredefinedMarketMembers();
  const tiv = members.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const pay = members.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
  const csvTiv = [...csv.values()].reduce((s, c) => s + c.tiv, 0);
  console.log(`  TIV      $${tiv.toFixed(1)}M   (${(tiv / pay).toFixed(2)}x payroll)`);
  console.log(`  payroll  $${pay.toFixed(1)}M`);
  check(Math.abs(tiv - csvTiv) < 1e-6, 'catalog TIV total === CSV TIV total',
    `$${tiv.toFixed(1)}M vs $${csvTiv.toFixed(1)}M`);
  console.log('\n  ⚠ THE TOTAL IS THE WEAKEST OF THESE CHECKS and is last on purpose. A uniform');
  console.log('  rescale applied to the CSV but not the catalog would fail section 1 on all 200');
  console.log('  members while the totals still agreed if the error were offsetting. Section 1');
  console.log('  is the check that matters; this one is a readout.');
}

console.log(failures === 0 ? '\nCATALOG AND CSV AGREE.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
