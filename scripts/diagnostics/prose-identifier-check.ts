// ============================================================================
// PROSE THAT NAMES CODE MUST NAME CODE THAT EXISTS — A STATIC GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/prose-identifier-check.ts
//
// Every piece of text a PLAYER can read — the export headers, the year-end
// narrative, the memos, every on-screen note, label and paragraph — is read out
// of src by the TypeScript parser, and anything in it shaped like a code
// identifier is looked up among the names the CODE declares or uses. A name
// that is not there fails, by file and line.
//
// ⚠ WHAT THIS CATCHES IS NARROW, AND THAT IS THE DESIGN. It does not check that
// a description is ACCURATE. It catches the commonest and cheapest way prose
// goes stale: naming something a rebuild removed. A sentence that says a flag is
// off while it is on, or describes an architecture in words that are all still
// defined, passes. The other half of the defence is interpolation — a sentence
// that states a value the code holds reads it from the code (GL_COMPONENT_NOTE's
// ceiling, the audit page's margin factors, the narrative's retentions) — and
// this gate is for the half that cannot be interpolated.
//
// ============================================================================
// WHAT COUNTS AS PROSE
//
//   string literals, template-literal text and JSX text of FOUR OR MORE words,
//   anywhere under src/, EXCLUDING
//     - comments (the parser never shows them to this gate),
//     - the arguments of `new ...Error(...)`, `throw` and `console.*` — those
//       are for a developer, and naming internals is their job,
//     - import/export specifiers, literal types, object keys, `case` labels,
//       element-access keys and the operands of ===/!== — those are code
//       wearing quotation marks,
//     - JSX attributes that are not text (className, key, id, style, href...).
//
// WHAT COUNTS AS AN IDENTIFIER IN IT
//
//   camelCase with an interior capital (glSeverityCap), SCREAMING_SNAKE with an
//   underscore (GL_SEVERITY_CAP), PascalCase of two humps or more (ResultSet),
//   any word written inside `backticks`, and a file name ending .ts/.tsx/.mjs.
//
// WHAT COUNTS AS EXISTING
//
//   an identifier in the CODE of any src file (the AST, so a name that survives
//   only in a comment or a string does NOT count — that is exactly the state a
//   removed name is left in); an identifier-shaped string literal in code (the
//   effect kinds, 'freqMultiplier', are values, not identifiers); a src file's
//   base name; a .md document in the repository; a script under
//   scripts/diagnostics or scripts/tools.
//
// ============================================================================
// ⚠ IS IT TRACTABLE? MEASURED BEFORE IT WAS BUILT, BECAUSE A CHECK WITH FALSE
// POSITIVES IS WORSE THAN NONE.
//
//   player-facing prose  1,176 strings, TWO unresolved names — medOnly and
//                        lawEnforcement, both in a sentence that says "these are
//                        NOT the retired ... tiers". Zero noise. Widening the
//                        extraction to PascalCase and backticks added none.
//   FILE HEADERS         5,303 comment lines, 48 unresolved mentions — and
//                        nearly all are DELIBERATE: "REINSURANCE_PROGRAMS ... are
//                        gone", "reportLag deleted", "Both retired", formula
//                        symbols (W_PRICE, levelGap), library APIs (lz-string's
//                        compressToUTF16). This repo's headers record what was
//                        removed on purpose, so a gate there would be a list of
//                        allowances, not a check. NOT GATED, for that reason.
//
// Developer comments cost an afternoon when stale; the export goes to a player.
// This gate covers the second.
//
// ============================================================================
// RETIRED_ON_PURPOSE — THE ONLY WAY TO NAME A REMOVED THING, AND IT IS CHECKED.
//
// A name here may appear in prose although no code declares it, because the
// prose is telling a reader it is gone. Each entry is checked in both
// directions, so the list cannot rot either:
//   - if the name is DECLARED in code again, the entry fails — it is no longer
//     retired and the prose that calls it retired is now the stale text;
//   - if no prose mentions it any more, the entry fails — a dead allowance.
//
// ============================================================================
// POSITIVE CONTROL. Before trusting a clean run, the same extractor and resolver
// are run over synthetic sources: a removed name in JSX text, in a template, in
// backticks and as a file must each FAIL; the same name in a comment, an Error
// message and a className must NOT be read as prose; a live name must pass. A
// gate that could not fail would read green here too.
// ============================================================================

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');

const RETIRED_ON_PURPOSE: Record<string, string> = {
  medOnly: 'claims export WC note: names the retired medOnly / temp / perm / catastrophic tiers so an old file maps',
  lawEnforcement: 'claims export GL note: names the retired general / epl / lawEnforcement / abuse sub-coverages',
};

const NON_TEXT_ATTR = new Set([
  'className', 'key', 'id', 'style', 'href', 'src', 'type', 'name', 'htmlFor', 'role',
  'd', 'viewBox', 'fill', 'stroke', 'target', 'rel', 'value',
]);

interface Prose { file: string; line: number; text: string }

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...listSources(p));
    else if (/\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function isCodeNotProse(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return true;
    if (ts.isNewExpression(p) && /Error$/.test(p.expression.getText())) return true;
    if (ts.isThrowStatement(p)) return true;
    if (ts.isCallExpression(p) && /^console\./.test(p.expression.getText())) return true;
    if (ts.isJsxAttribute(p) && NON_TEXT_ATTR.has(p.name.getText())) return true;
    if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
    if (ts.isPropertyAssignment(p) && p.name === n) return true;
    if (ts.isCaseClause(p) && p.expression === n) return true;
    if (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText())) return true;
  }
  return false;
}

/** The prose in one source file, and — into `names` — every name its code declares or uses. */
function scan(file: string, text: string, names: Set<string>): Prose[] {
  const sf = parse(file, text);
  const prose: Prose[] = [];
  const push = (n: ts.Node, raw: string) => {
    const t = raw.replace(/\s+/g, ' ').trim();
    if (t.split(' ').length < 4 || !/[a-z]/.test(t) || isCodeNotProse(n)) return;
    prose.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: t });
  };
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) names.add(n.text);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (/^[A-Za-z_$][\w$]*$/.test(n.text)) names.add(n.text);
      push(n, n.text);
    } else if (ts.isTemplateExpression(n)) {
      // The substitutions are code and are visited as code; only the text between them is prose.
      push(n, n.head.text + n.templateSpans.map(s => ' \u0000 ' + s.literal.text).join(''));
    } else if (ts.isJsxText(n)) {
      push(n, n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return prose;
}

const CAMEL = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g;
const SNAKE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const PASCAL = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g;
const TICKED = /`([^`]+)`/g;
const FILE = /\b[\w-]+\.(?:tsx?|mjs)\b/g;

interface Unresolved { file: string; line: number; name: string; context: string }

function unresolvedIn(prose: Prose[], known: Set<string>, fileExists: (f: string) => boolean): Unresolved[] {
  const out: Unresolved[] = [];
  for (const p of prose) {
    const t = p.text;
    const ticked = [...t.matchAll(TICKED)].flatMap(m => m[1].split(/[^\w$]+/).filter(w => /^[A-Za-z_$][\w$]*$/.test(w) && w.length > 1));
    const cands = new Set([...(t.match(CAMEL) ?? []), ...(t.match(SNAKE) ?? []), ...(t.match(PASCAL) ?? []), ...ticked]);
    const ctx = (w: string) => { const i = t.indexOf(w); return t.slice(Math.max(0, i - 50), i + w.length + 50); };
    for (const c of cands) if (!known.has(c)) out.push({ file: p.file, line: p.line, name: c, context: ctx(c) });
    for (const f of t.match(FILE) ?? []) if (!fileExists(f)) out.push({ file: p.file, line: p.line, name: f, context: ctx(f) });
  }
  return out;
}

function mdBases(dir: string, out: Set<string>): void {
  for (const f of fs.readdirSync(dir)) {
    if (/^(node_modules|\.git|dist)$/.test(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) mdBases(p, out);
    else if (f.endsWith('.md')) out.add(f.replace(/\.md$/, ''));
  }
}

// ---------------------------------------------------------------- the scan
const sources = listSources(SRC);
const codeNames = new Set<string>();
const prose: Prose[] = [];
for (const f of sources) prose.push(...scan(path.relative(ROOT, f), fs.readFileSync(f, 'utf8'), codeNames));

const srcBases = new Set(sources.map(f => path.basename(f).replace(/\.tsx?$/, '')));
const docs = new Set<string>();
mdBases(ROOT, docs);
const scriptFiles = new Set(['diagnostics', 'tools'].flatMap(d => {
  const dir = path.join(ROOT, 'scripts', d);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}));
const known = new Set([...codeNames, ...srcBases, ...docs, ...Object.keys(RETIRED_ON_PURPOSE)]);
const fileExists = (f: string) => srcBases.has(f.replace(/\.(tsx?|mjs)$/, '')) || scriptFiles.has(f);

const failures: string[] = [];
const unresolved = unresolvedIn(prose, known, fileExists);
for (const u of unresolved) {
  failures.push(`${u.file}:${u.line}  names \`${u.name}\`, which no code in src declares or uses\n      …${u.context}…`);
}

// The allowances, both directions.
const mentioned = new Set(unresolvedIn(prose, new Set([...codeNames, ...srcBases, ...docs]), fileExists).map(u => u.name));
for (const [name, why] of Object.entries(RETIRED_ON_PURPOSE)) {
  if (codeNames.has(name)) {
    failures.push(`RETIRED_ON_PURPOSE lists \`${name}\`, but code declares or uses it again — it is not retired, `
      + `so the prose calling it retired is now the stale text (${why})`);
  }
  if (!mentioned.has(name)) {
    failures.push(`RETIRED_ON_PURPOSE lists \`${name}\`, which no prose mentions any more — remove the dead allowance`);
  }
}

// ---------------------------------------------------------------- positive control
const CONTROL_SRC = `
  // A comment naming GONE_THING_IN_COMMENT is not prose.
  export function Panel() {
    const why = 'reads GONE_TEMPLATE_NAME for the value it shows here';
    if (Math.random() > 2) throw new Error('GONE_IN_ERROR is missing from the register entirely');
    return (
      <div className="goneClassName should never be read">
        This figure comes from REINSURANCE_PROGRAMS on the old quota share.
        It is read from \`goneTickedName\` every single year.
        See retiredModule.ts for the derivation of the figure.
        It is capped by glSeverityCap in every accident year.
        {why}
      </div>
    );
  }
`;
const controlNames = new Set<string>();
const controlProse = scan('control.tsx', CONTROL_SRC, controlNames);
const controlKnown = new Set([...codeNames, ...srcBases, ...docs]);
const controlHits = new Set(unresolvedIn(controlProse, controlKnown, fileExists).map(u => u.name));
const MUST_FAIL = ['REINSURANCE_PROGRAMS', 'GONE_TEMPLATE_NAME', 'goneTickedName', 'retiredModule.ts'];
const MUST_IGNORE = ['GONE_THING_IN_COMMENT', 'GONE_IN_ERROR', 'goneClassName', 'glSeverityCap'];
const controlFailures: string[] = [];
for (const n of MUST_FAIL) if (!controlHits.has(n)) controlFailures.push(`control: a removed name (${n}) was NOT caught`);
for (const n of MUST_IGNORE) if (controlHits.has(n)) controlFailures.push(`control: ${n} was flagged but must not be`);

// ---------------------------------------------------------------- --comments: a REPORT, never a failure
// The same resolver over every COMMENT in src. It exits 0 whatever it finds,
// because most of what it lists is deliberate history (see the tractability
// measurement above); it exists so a stale name in a developer comment — the
// PROPERTY_CAT_MODEL kind, cited in two comments and declared nowhere — is put in
// front of a reader rather than found by accident.
if (process.argv.includes('--comments')) {
  const comments: Prose[] = [];
  for (const f of sources) {
    const text = fs.readFileSync(f, 'utf8');
    const sf = parse(f, text);
    const seen = new Set<number>();
    const visitC = (n: ts.Node) => {
      for (const r of [...(ts.getLeadingCommentRanges(text, n.getFullStart()) ?? []), ...(ts.getTrailingCommentRanges(text, n.getEnd()) ?? [])]) {
        if (seen.has(r.pos)) continue;
        seen.add(r.pos);
        comments.push({ file: path.relative(ROOT, f), line: sf.getLineAndCharacterOfPosition(r.pos).line + 1, text: text.slice(r.pos, r.end).replace(/\s+/g, ' ') });
      }
      ts.forEachChild(n, visitC);
    };
    visitC(sf);
  }
  const hits = unresolvedIn(comments, known, fileExists);
  const byName = new Map<string, Unresolved[]>();
  for (const h of hits) byName.set(h.name, [...(byName.get(h.name) ?? []), h]);
  console.log(`COMMENT REPORT (not a gate): ${comments.length} comments, ${hits.length} mentions of ${byName.size} names no code declares`);
  for (const [name, hs] of [...byName].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${name}  (${hs.length})  ${hs.slice(0, 3).map(h => `${h.file}:${h.line}`).join('  ')}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- report
const files = new Set(prose.map(p => p.file));
console.log('PROSE IDENTIFIER CHECK');
console.log(`  ${prose.length} player-facing prose strings in ${files.size} of ${sources.length} src files`);
console.log(`  ${known.size} known names (code identifiers, identifier-shaped literals, src files, docs)`);
console.log(`  ${Object.keys(RETIRED_ON_PURPOSE).length} names allowed as RETIRED_ON_PURPOSE: ${Object.keys(RETIRED_ON_PURPOSE).join(', ')}`);
console.log(`  positive control: ${MUST_FAIL.length} removed names caught, ${MUST_IGNORE.length} non-prose/live names ignored — `
  + (controlFailures.length === 0 ? 'OK' : 'FAILED'));

const all = [...controlFailures, ...failures];
if (all.length > 0) {
  console.log(`\nFAIL — ${all.length}:`);
  for (const f of all) console.log(`  ${f}`);
  process.exit(1);
}
console.log('\nOK — every code-shaped name in player-facing prose exists in src, or is listed as retired on purpose.');
