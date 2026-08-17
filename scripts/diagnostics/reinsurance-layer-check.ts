// REINSURANCE LAYER TABLES — built from the actual claim generators.
//
//   npx tsx scripts/diagnostics/reinsurance-layer-check.ts
//
// DIAGNOSTIC ONLY. Reads the generators; changes no engine, parameter or
// pricing code. Nothing here is wired into processYear — the retention
// waterfall does not exist yet, and this file is the first place the
// cap -> retention -> layer sequence is expressed. When the waterfall IS
// built, it should reuse the shape below rather than re-deriving it.
//
// WHY THIS EXISTS: every dollar figure previously circulated for these layers
// came from a spreadsheet reconstruction with invented distributional
// parameters. The generators already produce the real draws, so no
// distributional assumption is needed — the layers can be measured instead of
// modelled.
//
// ============================================================================
// THE TOWER, AND WHY IT IS ASYMMETRIC
//
//   WC:  $4M xs $1M | $5M xs $5M | $15M xs $10M | xs $25M UNLIMITED
//   GL:  $4M xs $1M | $5M xs $5M | $15M xs $10M | NOTHING ABOVE $25M
//
// ⚠ GL STOPS AT $25M BECAUSE MARKET CAPACITY ABOVE THAT IS HARD TO FIND. That
// is a MARKET constraint, not a statement that the exposure is remote — the
// opposite, in fact: GL's law-enforcement severity is Pareto(alpha 1.3), which
// has infinite variance, and this harness sees occurrences well past $100M.
// The pool retains everything above $25M on GL, unlimited, and that band is
// what surplus stands behind.
//
// DO NOT "FIX" THIS ASYMMETRY by extending GL to match WC. The gap is the
// point. If a future edit adds an unlimited GL top layer, it is asserting that
// a market exists to write it, and that assertion needs its own evidence.
//
// Property is OUT OF SCOPE and not wired — its generators exist but are not
// connected to the live engine (see claimsExport.ts's header).
// ============================================================================
//
// OCCURRENCE BASIS. Layers attach to the OCCURRENCE total. Occurrence == claim
// for both WC and GL now — GL's multi-claimant abuse batches and its statutory
// cap (indemnity-only, state-law-only) both retired with the GL sub-coverage
// rebuild, so there is no longer a multi-claim sum or a cap-then-add-ALAE
// order to get wrong. Both lines layer the claim's grossUltimate directly.
//
// ============================================================================
// WHICH LAYER MEANS ARE ALLOWED A CONFIDENCE INTERVAL
//
// A FINITE layer's ceded amount per occurrence is bounded above by the layer
// limit. Bounded per-observation variance means the sample mean converges at
// 1/sqrt(n) and a normal CI is valid, however heavy the underlying severity
// tail is — the layer itself truncates the tail. This is the same reasoning
// that made binomial CIs valid on GL pay rates (finding 26).
//
// The UNLIMITED layer (WC xs $25M) has NO such bound, so its per-occurrence
// ceded inherits the full severity tail and its sample mean has no valid CI at
// any n. For that layer this harness reports a COUNT and a MEDIAN and labels
// the mean as indicative. Same for GL's retained-above-$25M band.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { computeKLine, generateWcClaims } from '../../src/utils/wcClaimEngine';
import { computeKGl, generateGlClaims } from '../../src/utils/glClaimEngine';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { Claim, CoverageLine, GameState, Member, Occurrence, ResultSet } from '../../src/types/simulation';

// --- horizons, chosen from a penetration probe rather than picked -----------
//
// The binding constraint is the TOP layer's event count. A 300-year probe put
// WC occurrences over $25M at 0.0033/yr — one event per 300 years — so 100
// events would need 30,000 years (~100 minutes at ~200ms/generated year). That
// layer is therefore NOT resolvable at any horizon this harness can run, and
// is reported as such rather than quoted with a spurious mean.
//
// GL is both cheaper to generate (~5ms/yr vs ~200ms) and far heavier-tailed, so
// it gets a much longer horizon and every GL layer resolves.
const WC_YEARS = 3_000;
const GL_YEARS = 20_000;
const RUN_B_GAMES = 100;
const RUN_B_LENGTH = 5;

interface Layer { name: string; att: number; limit: number }
const WC_LAYERS: Layer[] = [
  { name: '$4M xs $1M', att: 1e6, limit: 4e6 },
  { name: '$5M xs $5M', att: 5e6, limit: 5e6 },
  { name: '$15M xs $10M', att: 10e6, limit: 15e6 },
  { name: 'xs $25M UNLTD', att: 25e6, limit: Number.POSITIVE_INFINITY },
];
// No fourth layer. See the header: market capacity, not remoteness.
const GL_LAYERS: Layer[] = [
  { name: '$4M xs $1M', att: 1e6, limit: 4e6 },
  { name: '$5M xs $5M', att: 5e6, limit: 5e6 },
  { name: '$15M xs $10M', att: 10e6, limit: 15e6 },
];
const GL_TOWER_TOP = 25e6;

const fmt$ = (x: number) => x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(1)}k`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

// --- the waterfall, per J14 -------------------------------------------------

// One claim's contribution to its occurrence total. Neither line caps
// anything at generation time now — GL's statutory cap retired with the
// sub-coverage rebuild (see reinsuranceTower.ts's claimContribution, which
// this mirrors for cross-checking independence).
function claimContribution(c: Claim): number {
  return c.grossUltimate;
}

interface OccView { total: number; largestClaim: number; claimCount: number; source: string }

function occurrenceViews(claims: Claim[], occurrences: Occurrence[]): OccView[] {
  const byId = new Map(claims.map(c => [c.id, c]));
  const out: OccView[] = [];
  for (const o of occurrences) {
    let total = 0, largestClaim = 0, source = '?';
    for (const id of o.claimIds) {
      const c = byId.get(id);
      if (!c) continue;
      const amt = claimContribution(c);
      total += amt;
      if (amt > largestClaim) largestClaim = amt;
      // Occurrence == claim for both WC and GL now (GL's multi-claimant abuse
      // batches were deleted with the sub-coverage rebuild), so the first
      // claim's tier identifies the source for the whole occurrence exactly.
      if (source === '?') source = c.tier;
    }
    out.push({ total, largestClaim, claimCount: o.claimIds.length, source });
  }
  return out;
}

const cedeToLayer = (total: number, l: Layer) => Math.max(0, Math.min(total - l.att, l.limit));

// --- accumulator -----------------------------------------------------------

interface LayerAcc {
  perYear: number[];            // ceded in each simulated year — the CI sample
  events: number;               // occurrences penetrating the layer
  bySource: Record<string, number>;
  cededPerEvent: number[];      // for the unlimited layer's median
}
const newAcc = (): LayerAcc => ({ perYear: [], events: 0, bySource: {}, cededPerEvent: [] });

function reportLayers(label: string, layers: Layer[], accs: LayerAcc[], years: number) {
  console.log(`\n  ${label}`);
  console.log('    layer            expected ceded/yr   penetrations/yr   99% CI on the mean');
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i], a = accs[i];
    const m = mean(a.perYear);
    const finite = Number.isFinite(l.limit);
    let ci = '';
    if (!finite) {
      ci = 'NOT VALID — unlimited layer, unbounded per-occurrence ceded';
    } else if (a.events < 30) {
      ci = `UNRESOLVED — only ${a.events} events in ${years} yrs`;
    } else {
      const sd = Math.sqrt(mean(a.perYear.map(x => (x - m) ** 2)));
      const half = 2.576 * sd / Math.sqrt(years);
      ci = `+/-${fmt$(half)} (${(half / Math.max(m, 1) * 100).toFixed(1)}%)`;
    }
    console.log(`    ${l.name.padEnd(15)} ${fmt$(m).padStart(17)}   ${(a.events / years).toFixed(4).padStart(15)}   ${ci}`);
  }
  console.log('    source attribution of ceded loss:');
  for (let i = 0; i < layers.length; i++) {
    const a = accs[i];
    const tot = Object.values(a.bySource).reduce((s, v) => s + v, 0);
    if (tot <= 0) { console.log(`    ${layers[i].name.padEnd(15)} (never penetrated)`); continue; }
    const parts = Object.entries(a.bySource).sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k} ${pct(v / tot)}`).join('  ');
    console.log(`    ${layers[i].name.padEnd(15)} ${parts}`);
  }
  const unlimited = layers.findIndex(l => !Number.isFinite(l.limit));
  if (unlimited >= 0) {
    const a = accs[unlimited];
    console.log(`    ${layers[unlimited].name}: ${a.events} events in ${years} yrs; ` +
      `median ceded per event ${a.cededPerEvent.length ? fmt$(quantile(a.cededPerEvent, 0.5)) : 'n/a'}, ` +
      `max ${a.cededPerEvent.length ? fmt$(Math.max(...a.cededPerEvent)) : 'n/a'}`);
    console.log(`      mean is INDICATIVE ONLY — see the header on unlimited layers.`);
  }
}

// --- generator drivers -----------------------------------------------------

function drawYear(line: CoverageLine, members: Member[], k: number, seed: number, year: number) {
  return line === 'WC'
    ? generateWcClaims({ members, yearNumber: year, calendarYear: 2025 + year, instanceSeed: seed, kLine: k, riskControlEffectiveness: 0 })
    : generateGlClaims({ members, yearNumber: year, calendarYear: 2025 + year, instanceSeed: seed, kGl: k, gPool: 1, riskControlEffectiveness: 0 });
}

interface ExtraAcc { over25: number; over25WithBigClaim: number; glRetainedAbove: number[]; glRetainedEvents: number; glLargest: number; retainedBelow: number[] }

function runA(line: CoverageLine, members: Member[], years: number, layers: Layer[], seedBase: number) {
  const k = line === 'WC' ? computeKLine(members) : computeKGl(members);
  const accs = layers.map(newAcc);
  const extra: ExtraAcc = { over25: 0, over25WithBigClaim: 0, glRetainedAbove: [], glRetainedEvents: 0, glLargest: 0, retainedBelow: [] };
  for (let y = 0; y < years; y++) {
    const res = drawYear(line, members, k, seedBase + y * 31337, 1);
    const views = occurrenceViews(res.claims, res.occurrences);
    const yearCeded = layers.map(() => 0);
    let retainedBelow = 0, retainedAbove = 0;
    for (const v of views) {
      retainedBelow += Math.min(v.total, layers[0].att);
      layers.forEach((l, i) => {
        const c = cedeToLayer(v.total, l);
        if (c > 0) {
          yearCeded[i] += c; accs[i].events += 1;
          accs[i].bySource[v.source] = (accs[i].bySource[v.source] ?? 0) + c;
          if (!Number.isFinite(l.limit)) accs[i].cededPerEvent.push(c);
        }
      });
      if (v.total > GL_TOWER_TOP) {
        extra.over25 += 1;
        if (v.largestClaim > GL_TOWER_TOP) extra.over25WithBigClaim += 1;
        if (line === 'GL') { retainedAbove += v.total - GL_TOWER_TOP; extra.glRetainedEvents += 1; if (v.total > extra.glLargest) extra.glLargest = v.total; }
      }
    }
    layers.forEach((_, i) => accs[i].perYear.push(yearCeded[i]));
    extra.retainedBelow.push(retainedBelow);
    if (line === 'GL') extra.glRetainedAbove.push(retainedAbove);
  }
  return { accs, extra };
}

// --- RUN B: real games -----------------------------------------------------

function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }

function playGame(id: string, lines: CoverageLine[], years: number): ResultSet[] {
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

// ===========================================================================

console.log('=== REINSURANCE LAYER TABLES, measured from the generators ===');
console.log(`WC horizon ${WC_YEARS} yrs | GL horizon ${GL_YEARS} yrs | RUN B ${RUN_B_GAMES} games x ${RUN_B_LENGTH} yrs`);
console.log('Occurrence basis. Occurrence == claim for both WC and GL — no cap, no multi-claim batching on either line.');

const fullMarket = getPredefinedMarketMembers();

// Enrolled books, taken from real games rather than a mechanical subset, so
// underwriting SELECTION is present — the enrolled book is not a random 30% of
// the market, it is the 30% the pool chose to write.
console.log('\n--- building enrolled books from real year-1 games (selection matters) ---');
const enrolledBooks: Record<string, Member[]> = { WC: [], GL: [] };
{
  const locked = playGame('LAYERCHK', ['WC', 'GL'], 1);
  for (const line of ['WC', 'GL'] as CoverageLine[]) {
    const lr = locked[0].byLine[line];
    enrolledBooks[line] = lr?.memberList ?? [];
    const pay = enrolledBooks[line].reduce((s, m) => s + (m.exposureByLine[line] ?? 0), 0);
    const full = fullMarket.reduce((s, m) => s + (m.exposureByLine[line] ?? 0), 0);
    console.log(`  ${line}: ${enrolledBooks[line].length} enrolled members, $${pay.toFixed(0)}M of $${full.toFixed(0)}M exposure (${pct(pay / full)})`);
  }
}

console.log('\n=== RUN A — EXPECTED ANNUAL CEDED LOSS PER LAYER ===');
const runAResults: Record<string, ReturnType<typeof runA>> = {};
for (const line of ['WC', 'GL'] as CoverageLine[]) {
  const layers = line === 'WC' ? WC_LAYERS : GL_LAYERS;
  const years = line === 'WC' ? WC_YEARS : GL_YEARS;
  for (const [basis, book] of [['FULL-MARKET', fullMarket], ['ENROLLED', enrolledBooks[line]]] as const) {
    const t0 = Date.now();
    const r = runA(line, book, years, layers, line === 'WC' ? 12_000_003 : 13_000_003);
    runAResults[`${line}|${basis}`] = r;
    reportLayers(`${line} — ${basis} basis (${years} yrs, ${((Date.now() - t0) / 1000).toFixed(0)}s)`, layers, r.accs, years);
    console.log(`    retained BELOW the $1M retention: ${fmt$(mean(r.extra.retainedBelow))}/yr`);
    if (basis === 'ENROLLED') console.log('    ^^ ENROLLED IS THE SIZING BASIS — the tower attaches to pool claims, not market claims.');
  }
}

console.log('\n=== GL RETAINED ABOVE $25M — the band no market will write ===');
for (const [basis, key] of [['FULL-MARKET', 'GL|FULL-MARKET'], ['ENROLLED', 'GL|ENROLLED']] as const) {
  const e = runAResults[key].extra;
  const m = mean(e.glRetainedAbove);
  console.log(`  ${basis}: expected ${fmt$(m)}/yr, ${(e.glRetainedEvents / GL_YEARS).toFixed(4)} events/yr, largest occurrence ${fmt$(e.glLargest)}`);
  console.log(`    median in a year that has one: ${fmt$(quantile(e.glRetainedAbove.filter(x => x > 0), 0.5))}` +
    `, P99 of annual retained-above: ${fmt$(quantile(e.glRetainedAbove, 0.99))}`);
  console.log(`    mean INDICATIVE ONLY — unbounded band, no valid CI.`);
}

console.log('\n=== OCCURRENCES OVER $25M: regression guard — occurrence == claim on both lines now ===');
for (const line of ['WC', 'GL'] as CoverageLine[]) {
  for (const basis of ['FULL-MARKET', 'ENROLLED'] as const) {
    const e = runAResults[`${line}|${basis}`].extra;
    if (e.over25 === 0) { console.log(`  ${line} ${basis}: no occurrence exceeded $25M`); continue; }
    console.log(`  ${line} ${basis}: ${e.over25} occurrences > $25M, of which ${e.over25WithBigClaim} ` +
      `(${pct(e.over25WithBigClaim / e.over25)}) contain a single claim that large`);
  }
}

console.log('\n=== RUN B — IS EACH LAYER A LIVE MECHANIC ON A PLAYABLE HORIZON? ===');
console.log(`${RUN_B_GAMES} independent ${RUN_B_LENGTH}-year games at DEFAULT decisions; enrolled claims only,`);
console.log('real membership churn and real pool-year factors. Ceded is summed over the whole game.');
{
  const perGame: Record<string, number[]> = {};
  const keys = [...WC_LAYERS.map(l => `WC ${l.name}`), ...GL_LAYERS.map(l => `GL ${l.name}`), 'GL retained >$25M'];
  for (const kk of keys) perGame[kk] = [];
  const t0 = Date.now();
  for (let g = 0; g < RUN_B_GAMES; g++) {
    const locked = playGame(`RB${String(g).padStart(4, '0')}`, ['WC', 'GL'], RUN_B_LENGTH);
    const tally: Record<string, number> = {};
    for (const r of locked) {
      for (const line of ['WC', 'GL'] as CoverageLine[]) {
        const lr = r.byLine[line];
        if (!lr?.occurrences?.length) continue;
        const layers = line === 'WC' ? WC_LAYERS : GL_LAYERS;
        for (const v of occurrenceViews(lr.claims ?? [], lr.occurrences)) {
          for (const l of layers) {
            const c = cedeToLayer(v.total, l);
            if (c > 0) tally[`${line} ${l.name}`] = (tally[`${line} ${l.name}`] ?? 0) + c;
          }
          if (line === 'GL' && v.total > GL_TOWER_TOP) tally['GL retained >$25M'] = (tally['GL retained >$25M'] ?? 0) + (v.total - GL_TOWER_TOP);
        }
      }
    }
    for (const kk of keys) perGame[kk].push(tally[kk] ?? 0);
    if ((g + 1) % 20 === 0) console.log(`  ...${g + 1}/${RUN_B_GAMES} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  console.log('\n  band                    never touched   median      P90         max');
  for (const kk of keys) {
    const xs = perGame[kk];
    const never = xs.filter(x => x === 0).length / xs.length;
    console.log(`  ${kk.padEnd(23)} ${pct(never).padStart(13)}   ${fmt$(quantile(xs, 0.5)).padStart(9)}   ${fmt$(quantile(xs, 0.9)).padStart(9)}   ${fmt$(Math.max(...xs)).padStart(9)}`);
  }
  console.log('\n  A layer never touched in most 5-year games is not a live mechanic at that horizon,');
  console.log('  however well it prices — the player never sees it pay.');
}

console.log('\n=== AGGREGATE STOP PLACEMENT — implication only, not a decision ===');
{
  const wc = runAResults['WC|ENROLLED'].extra, gl = runAResults['GL|ENROLLED'].extra;
  const below = mean(wc.retainedBelow) + mean(gl.retainedBelow);
  const above = mean(gl.glRetainedAbove);
  console.log(`  ENROLLED basis, the two bands an aggregate could cover:`);
  console.log(`    (1) retained BELOW the $1M retention   ${fmt$(below)}/yr   — frequent, bounded, poolable`);
  console.log(`    (2) GL retained ABOVE the $25M tower   ${fmt$(above)}/yr   — rare, UNBOUNDED, largest seen ${fmt$(gl.glLargest)}`);
  console.log(`  If the aggregate sits ABOVE THE WHOLE TOWER it covers both, which means it covers`);
  console.log(`  band (2) — the same band the per-occurrence market declined to write. An aggregate`);
  console.log(`  reinsurer would price that capacity the same way, so "above the whole tower" is not`);
  console.log(`  a cheaper route to the cover the tower could not buy.`);
  console.log(`  If it only picks up RETAINED LOSSES BELOW THE RETENTION it covers band (1) only:`);
  console.log(`  a genuine frequency protection with a bounded payout, leaving band (2) on surplus.`);
  console.log(`  The two choices are not variations of one product; they are different products.`);
}

console.log('\nDONE — diagnostic only, no engine or parameter change.');
