// WHAT WC'S ABOVE-TOWER RETAINED BAND COSTS. Report only — nothing here is
// asserted and nothing is capped.
//
//   GAMES=200 YEARS=8 npx tsx scripts/diagnostics/wc-above-tower-report.ts
//
// ⚠ THE SEVERITY-CAP DECISION THIS REPORT EXISTED TO INFORM HAS BEEN TAKEN, and
// its answer changes how the report reads. WC_SEVERITY_CAP is now $85M, so the
// band above the tower is BOUNDED at $85M - $50M = $35M per occurrence. Every
// line has a finite ceiling now.
//
// This header used to say "WC is the only uncapped line, so it is the only line
// where retained above tower is an unbounded quantity rather than a band with a
// known ceiling", and closed with "REPORT ONLY — nothing above is asserted and
// no cap was changed". Both were true when written and neither is now.
//
// ⚠ SECTION 2's SAMPLE MAXIMUM IS THE FIGURE MOST CHANGED BY THAT, and it is
// the one to be careful about. It used to be unbounded above — "a longer run
// finds a larger worst year indefinitely" — and it no longer is: no occurrence
// can exceed $85M, so the largest possible above-tower band is exactly $35M and
// a year's total is bounded only by how many such occurrences it contains.
// The EXPECTED cost and the return period remain the two figures worth reading.
//
// WHAT IT STILL MEASURES, and why it is still worth running: the expected
// annual retained-above-tower loss on the DEFAULT decision set (full tower
// placed, which is the arm where the band is the pool's only remaining
// exposure), how often it is non-zero at all, and the worst single year seen.
// A bounded band is not a free one — $35M per occurrence against a pool
// carrying ~$20M of surplus is still the largest single retained exposure WC
// has, and the cap changed its ceiling rather than its importance.
//
// ⚠ MEASURED WITH THE FULL TOWER PLACED, deliberately. Declining layers puts
// loss back BELOW the tower top, not above it, so retainedAboveTower is
// unaffected by placement — but pricing and surplus are, and the worst-year
// figure is only interpretable against a stated arm.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { TOWER_TOP } from '../../src/data/reinsuranceTower';
import { occurrenceTotals } from '../../src/utils/reinsuranceTower';
import { computeKLine, generateWcClaims } from '../../src/utils/wcClaimEngine';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 200);
const YEARS = Number(process.env.YEARS ?? 8);
// Generated years for the tail section. Large on purpose — see its header.
const GEN_YEARS = Number(process.env.GEN_YEARS ?? 50_000);
const REF_YEAR = 1;
const ROSTER = getPredefinedMarketMembers();
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

const seedOf = (id: string) => {
  let h = 5381;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; }
  return h >>> 0;
};
const fmt$ = (x: number) => x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(1)}k`;

// Same id alphabet the game uses, so these are ordinary instances rather than a
// special construction.
const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function idFor(n: number): string {
  let out = '', x = seedOf(`WCTOWER-${n}`);
  for (let i = 0; i < 8; i++) { out += ALPHA[x % ALPHA.length]; x = Math.floor(x / ALPHA.length) + 7 * (i + 1); }
  return out;
}

function play(id: string): ResultSet[] {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'G', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return gs.lockedResults;
}

console.log(`WC ABOVE-TOWER RETAINED BAND — ${GAMES} games x ${YEARS} years, default decisions`);
console.log(`Tower tops: WC ${fmt$(TOWER_TOP.WC)}  GL ${fmt$(TOWER_TOP.GL)}  Property ${fmt$(TOWER_TOP.Property)}`);
console.log('WC severity is UNCAPPED, so its band has no ceiling; the other two do.\n');

interface Row { line: CoverageLine; years: number; nonZero: number; total: number; worst: number; worstAt: string; }
const rows: Record<string, Row> = {};
for (const l of LINES) rows[l] = { line: l, years: 0, nonZero: 0, total: 0, worst: 0, worstAt: '—' };

// Every non-zero WC year, kept so the tail can be described by percentile of
// the OCCURRENCES rather than only by its maximum — one outlier maximum says
// much less than the shape around it.
const wcHits: number[] = [];
// Surplus context for the worst WC year: an unbounded band only matters
// relative to what the pool has to absorb it with.
let worstSurplusAfter = 0, worstSurplusBefore = 0;


for (let g = 0; g < GAMES; g++) {
  const id = idFor(g);
  let results: ResultSet[];
  try { results = play(id); } catch (e) { console.log(`  ${id}: threw, skipped (${(e as Error).message})`); continue; }
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    for (const l of LINES) {
      const lr = r.byLine[l];
      if (!lr) continue;
      const above = lr.retainedAboveTower ?? 0;
      const row = rows[l];
      row.years++;
      row.total += above;
      if (above > 0) { row.nonZero++; if (l === 'WC') wcHits.push(above); }
      if (above > row.worst) {
        row.worst = above;
        row.worstAt = `${id} y${i + 1}`;
        if (l === 'WC') {
          worstSurplusAfter = r.endingSurplus;
          worstSurplusBefore = i > 0 ? results[i - 1].endingSurplus : r.endingSurplus + (r.endingSurplus - r.endingSurplus);
        }
      }
    }
  }
}

console.log('line       | yrs  | yrs with band>0 | expected $/yr  | worst single year        | worst at');
for (const l of LINES) {
  const r = rows[l];
  const pct = r.years > 0 ? (100 * r.nonZero / r.years).toFixed(2) : '—';
  const exp = r.years > 0 ? r.total / r.years : 0;
  console.log(`${l.padEnd(10)} | ${String(r.years).padStart(4)} | ${String(r.nonZero).padStart(5)} (${pct.padStart(5)}%) | ${fmt$(exp).padStart(13)} | ${fmt$(r.worst).padStart(23)} | ${r.worstAt}`);
}

if (wcHits.length > 0) {
  wcHits.sort((a, b) => a - b);
  const q = (p: number) => wcHits[Math.min(wcHits.length - 1, Math.floor(p * wcHits.length))];
  console.log(`\nWC, conditional on the band firing at all (${wcHits.length} years):`);
  console.log(`  median ${fmt$(q(0.5))}  p75 ${fmt$(q(0.75))}  p90 ${fmt$(q(0.9))}  p99 ${fmt$(q(0.99))}  max ${fmt$(wcHits[wcHits.length - 1])}`);
  console.log(`  mean when it fires ${fmt$(wcHits.reduce((s, x) => s + x, 0) / wcHits.length)}`);
  console.log(`\nWorst WC year in context: surplus ${fmt$(worstSurplusBefore)} entering, ${fmt$(worstSurplusAfter)} leaving.`);
} else {
  console.log('\nWC band never fired in this sample. Widen GAMES before concluding anything from that.');
}

// ============================================================================
// SECTION 2. THE TAIL, SAMPLED DIRECTLY.
//
// ⚠ SECTION 1's MAXIMUM IS NOT THE WORST CASE AND MUST NOT BE READ AS ONE.
// The band fires on well under 1% of years, so a few hundred games buy only a
// handful of observations and the largest of those says almost nothing about
// the distribution's shape. WC's own severity work records a 1-in-250-year
// claim at $71.2M and a $248.84M claim seen in 1,000 game-years — both far
// above anything section 1 sampled, which is evidence that section 1 is
// under-sampled rather than evidence that the tail is small.
//
// So sample the GENERATOR instead of the game. generateWcClaims on a fixed
// reference book, many years, no shocks — orders of magnitude cheaper per
// year than processYear, which is what makes a tail-resolving sample size
// affordable. This measures the same quantity section 1 does: retained loss
// above WC's $50M tower top, with the whole tower purchased.
console.log('\n=== 2. THE TAIL, SAMPLED FROM THE GENERATOR ===');
{
  // ⚠ FULL 200-MEMBER MARKET, MATCHING wc-severity-rebuild-check's basis —
  // "all 200 canonical members, $1,300M payroll" — not section 1's live
  // active book (which is smaller: default games enrol a subset and grow it
  // over time). That basis is what produced the $71.2M 1-in-250 and $248.84M
  // figures this section's numbers are meant to sit alongside, so matching it
  // makes the two comparable. Section 1 and section 2 are measuring at
  // DIFFERENT scales on purpose: section 1 is what an actual game experiences,
  // section 2 is the line's inherent tail on the standard reference basis. Do
  // not average or otherwise combine the two sections' numbers.
  const book = ROSTER.filter(m => (m.exposureByLine.WC ?? 0) > 0);
  const kLine = computeKLine(book);
  const bookExposure = book.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
  // exposureByLine IS ALREADY IN $M (see LineResultSet.activeExposure's own
  // comment) — running it through fmt$, which expects raw dollars, was this
  // script's first bug and is why an earlier run of this printed "$1.3k".
  console.log(`  reference book ${book.length} members, $${bookExposure.toFixed(1)}M WC exposure (full market), kLine ${kLine.toFixed(4)}`);
  console.log(`  ${GEN_YEARS} generated years, no shocks, risk control 0, year ${REF_YEAR} trend\n`);

  let above = 0, hits = 0, worstYear = 0, worstClaim = 0;
  const perYear: number[] = [];
  for (let y = 0; y < GEN_YEARS; y++) {
    const g = generateWcClaims({
      members: book, yearNumber: REF_YEAR, calendarYear: 2026,
      instanceSeed: seedOf(`WCTAIL-${y}`), kLine, riskControlEffectiveness: 0,
    });
    // ⚠ PER OCCURRENCE, VIA THE TOWER'S OWN ARITHMETIC. occurrenceTotals +
    // claimContribution is exactly what cedeOccurrences uses, so this measures
    // the same quantity the engine does. Summing raw grossUltimate per CLAIM
    // would be a different number wherever an occurrence carries more than one.
    let yearAbove = 0;
    for (const t of occurrenceTotals(g.claims, g.occurrences)) {
      if (t > worstClaim) worstClaim = t;
      yearAbove += Math.max(0, t - TOWER_TOP.WC);
    }
    above += yearAbove;
    perYear.push(yearAbove);
    if (yearAbove > 0) hits++;
    if (yearAbove > worstYear) worstYear = yearAbove;
  }
  perYear.sort((a, b) => a - b);
  const q = (pp: number) => perYear[Math.min(perYear.length - 1, Math.floor(pp * perYear.length))];
  console.log(`  expected above-tower retained loss   ${fmt$(above / GEN_YEARS)}/yr`);
  console.log(`  years the band fires                 ${hits} of ${GEN_YEARS} (${(100 * hits / GEN_YEARS).toFixed(3)}%)`);
  console.log(`  return period                        1 in ${hits > 0 ? (GEN_YEARS / hits).toFixed(0) : '—'} years`);
  console.log(`  worst year in the sample             ${fmt$(worstYear)}`);
  console.log(`  largest single occurrence         ${fmt$(worstClaim)}`);
  console.log(`  all-years percentiles  p99 ${fmt$(q(0.99))}  p99.9 ${fmt$(q(0.999))}`);
  console.log(`\n  ⚠ THE MAXIMUM IS A SAMPLE MAXIMUM OF A NOW-BOUNDED QUANTITY. It used to`);
  console.log(`  there is no value this converges to — a longer run finds a larger worst`);
  console.log(`  year indefinitely. The EXPECTED cost and the return period are the two`);
  console.log(`  figures here that are estimates of something finite.`);
}

console.log('\nREPORT ONLY — nothing above is asserted. The cap this informed is now in force.');
