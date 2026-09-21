import React, { useState } from 'react';
import { Users, UserPlus, UserMinus, Globe } from 'lucide-react';
import type { ResultSet, Member, StartingFinancials, MemberLossHistory, CoverageLine, LineView } from '../types/simulation';
import { formatMillions, formatPct } from '../utils/formatters';
import { getMemberExposure, selectResultView } from '../utils/lineHelpers';
import { LINE_FULL_NAME } from '../utils/lineDisplay';
import { EXPERIENCE_MOD, memberExperienceMods } from '../utils/memberExperienceMod';
import { OPENING_SATISFACTION } from '../data/memberCatalog';
import { experienceWindow } from '../utils/memberLossHistory';

interface MembershipPageProps {
  lockedResults: ResultSet[];
  startingFinancials: StartingFinancials;
  initialMembers: Member[];
  startingYear: number;
  /**
   * The rolling loss ledger, for the experience-modifier column.
   *
   * ⚠ COMPUTED HERE FROM THE LEDGER, NOT READ OFF memberPremiumShares. The
   * shares carry the same mod and are STRIPPED FROM SAVES, so a page that
   * rendered them would show the column on a fresh game and blank it after a
   * reload — the exact silent degradation gameSave.ts keeps memberLossResults
   * off the strip list to avoid. The ledger IS saved, and
   * memberExperienceMods is pure, so recomputing is both cheap and reload-safe.
   */
  memberLossHistory: MemberLossHistory;
  /**
   * ⚠ THE PER-MEMBER EXPERIENCE COLUMNS ARE PER LINE, SO THEY NEED THIS. A
   * member has one loss ratio PER LINE, one loss cost per line and one exposure
   * per line — not one of each. On 'pool' those three columns are ABSENT rather
   * than blank; see the note above the table for why absent rather than dashes.
   */
  lineView: LineView;
  /** The pool's lines — needed only to decide whether the POOL view's exposure
   *  tiles share one unit basis. See EXPOSURE_BASIS. */
  activeLines: CoverageLine[];
}

export default function MembershipPage({ lockedResults, startingFinancials, initialMembers, startingYear, memberLossHistory, lineView, activeLines }: MembershipPageProps) {
  // The line whose per-member record this table can show, or null on the pool
  // view where no such record exists.
  const expLine: CoverageLine | null = lineView === 'pool' ? null : lineView;
  // Exposure is DISPLAYED NOMINAL — in the dollars of the latest completed year,
  // matching the premium and member charge shown elsewhere. Roster payroll is
  // frozen in year-1 dollars; wageFactor carries it forward. See lineHelpers.
  const displayYear = lockedResults.length > 0 ? lockedResults[lockedResults.length - 1].yearNumber : 1;
  // ⚠ WC AND GL ARE PER $100 OF PAYROLL; PROPERTY IS PER $100 OF TIV. The two
  // exposure tiles are only meaningful where one basis applies — see their note.
  const EXPOSURE_BASIS: Record<CoverageLine, 'Payroll' | 'TIV'> = { WC: 'Payroll', GL: 'Payroll', Property: 'TIV' };
  // ⚠ 'riskQuality' IS GONE FROM THIS UNION AND THAT IS LOAD-BEARING. Risk
  // quality is no longer shown per member anywhere, so there is nothing to
  // sort by; leaving the key would let a future column reintroduce the
  // attribute with a one-word change. surface-privacy-check asserts the
  // absence across every page and export.
  // ⚠ 'mod' IS GONE FROM THIS UNION FOR THE SAME REASON 'riskQuality' IS. The
  // Experience Mod column was removed: the LOSS RATIO is the number that
  // matters — it is what Renewal Underwriting acts on and what an underwriter
  // reads — and the mod is that ratio's billing consequence, damped by
  // credibility. Showing both invited a comparison between a record and its
  // own damped restatement, which is not a comparison anybody should make.
  const [sortKey, setSortKey] = useState<'name' | 'exposure' | 'satisfaction' | 'ratio' | 'lossCost' | 'yearJoined'>('exposure');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // ============================================================================
  // ⚠ EVERY FIGURE ON THIS PAGE READS THE VIEW'S ROW, NOT THE POOL'S.
  //
  // It used to read the pool row for all ten tiles and for the roster, whatever
  // the line bar said — so a WC+GL pool on the WC view reported 116 Active
  // Members (the distinct union across both lines) and listed all 116 under a
  // heading reading Workers' Compensation. The experience COLUMNS were taught to
  // follow the view; the set they describe was not, which left the page
  // describing one population with another population's numbers.
  //
  // selectResultView is the same one-line filter every other line-view page
  // uses, and on 'pool' it returns lockedResults BY REFERENCE — so the Pool view
  // is provably the pool row rather than merely tested to match it.
  // ============================================================================
  const viewRows = selectResultView(lockedResults, lineView);
  const last = viewRows[viewRows.length - 1];
  // The pool row is still needed for ONE thing: averaging a member's
  // satisfaction across the lines they hold, which is a pool-scope question and
  // only asked on the pool view.
  const poolLast = lockedResults[lockedResults.length - 1];

  const activeMembers: Member[] = last ? last.memberList : initialMembers;
  const newThisYear = last ? last.newMembers : 0;
  const withdrawnThisYear = last ? last.withdrawnMembers : 0;
  const retentionRate = last?.memberRetentionRate ?? 1;
  const satisfaction = last?.memberSatisfaction ?? startingFinancials.memberSatisfaction;
  const avgRiskQuality = last?.averageRiskQuality ?? startingFinancials.riskQuality;
  const activeExposure = last?.activeExposure ?? startingFinancials.activeExposure;
  const totalMarketExposure = last?.totalMarketExposure ?? startingFinancials.totalMarketExposure;
  const marketShare = last?.marketShare ?? startingFinancials.marketShare;

  // THE EXPERIENCE MODIFIER, ON WC — the line this page's payroll column is
  // already on. Centred on the MEDIAN of the rated book, so 1.00 reads as
  // "typical member" rather than as "exposure-weighted average member"; see
  // memberExperienceMod.ts for why the charged mod cannot use the median and
  // why this one must.
  //
  // ⚠ TWO COLUMNS, NOT ONE, AND THEY ARE NOT THE SAME NUMBER TWICE. The RATIO
  // is what the member cost — actual primary loss over their own expected
  // primary loss. The MOD is what they are charged for it, and it is damped by
  // design: Z is 0.155 on WC, so 84.5% of the mod is the class average. A
  // member who ran 3x their expected cost is charged about 1.31.
  //
  // Showing only the mod hid that, and it is exactly what made Renewal
  // Underwriting unreadable while its tiers were mod numbers — a member the
  // pool might decline looked like a member charged 31% over. Showing only the
  // ratio would hide what anyone actually pays. Side by side, the gap between
  // the columns IS the credibility weighting, which is the thing worth seeing.
  //
  // ⚠ THE RATIO SHOWN IS RAW, AND THE RENEWAL TIER COMPARES THE CLAMPED ONE.
  // The raw figure is what the member cost and a reader has to be able to tell
  // 3.2 from 11.0. The clamp keeps the threshold stable. So a member at 11.0
  // and one at 3.2 both sit above a 2.50 tier and are declined together — the
  // decision screen says so rather than leaving it to be discovered here.
  // ⚠ TWO SATISFACTION NUMBERS ON THIS PAGE AND THEY ARE NOT THE SAME QUANTITY.
  // The CHIP above reads `last.memberSatisfaction`, the POOL-LEVEL scalar that
  // feeds retention; this one is the mean of the per-member column below, which
  // feeds nothing. They can and do disagree, and the metric is relabelled rather
  // than left reading "Avg. Satisfaction" beside a column it is not the average
  // of. See memberSatisfaction.ts's seam note on why converging them is a
  // measurement commit rather than a tidy-up.
  //
  // ⚠ BLENDED ACROSS THE LINES THE MEMBER IS ACTUALLY ENROLLED IN, WHICH THE
  // FIRST-LINE FOLD DID NOT DO. Satisfaction is per member PER LINE — a member
  // in WC and Property compares each separately and can be getting a bargain on
  // one while paying over the odds on the other — but Member.satisfaction is a
  // single field, so processYear's roster fold keeps the FIRST active line's
  // copy, exactly as it folds `status`. Reading that fold showed one line's
  // opinion and labelled it the member's.
  //
  // `byLine` carries each line's own roster, so the blend is available here
  // without changing what the engine stores.
  //
  // ⚠ EQUAL WEIGHT PER ENROLLED LINE, AND THE ALTERNATIVE IS A UNIT ERROR. The
  // natural weight is the member's bill, and the natural proxy for it is
  // exposure — but WC/GL exposure is payroll in $M and Property's is insured
  // value in $M, and simulationEngine's own note calls summing them
  // "dimensionally meaningless at pool scope". The premium shares that WOULD be
  // comparable are stripped from saves, so a reloaded game could not compute
  // them. Equal weight is the honest choice available on every game, and it is
  // named rather than left to look like a considered weighting.
  const satisfactionByMember = React.useMemo(() => {
    const out = new Map<string, number>();
    // ⚠ POOL ONLY, BY CONSTRUCTION. Averaging a member's satisfaction across the
    // lines they hold answers a pool-scope question. On a line view the member
    // appears once, carrying that line's own satisfaction, and the fallback
    // below returns it untouched — which is the right answer there.
    if (!poolLast || lineView !== 'pool') return out;
    const sums = new Map<string, { total: number; lines: number }>();
    for (const line of Object.keys(poolLast.byLine) as Array<keyof typeof poolLast.byLine>) {
      for (const m of poolLast.byLine[line]?.memberList ?? []) {
        const e = sums.get(m.id) ?? { total: 0, lines: 0 };
        e.total += m.satisfaction; e.lines += 1;
        sums.set(m.id, e);
      }
    }
    for (const [id, e] of sums) if (e.lines > 0) out.set(id, e.total / e.lines);
    return out;
  }, [poolLast, lineView]);
  const satisfactionOf = (m: Member) => satisfactionByMember.get(m.id) ?? m.satisfaction;

  const memberMeanSatisfaction = activeMembers.length > 0
    ? activeMembers.reduce((s, m) => s + satisfactionOf(m), 0) / activeMembers.length
    : satisfaction;

  // ============================================================================
  // ⚠ THIS PAGE USED TO BE A WC VIEW, UNCONDITIONALLY, AND SAID SO ONLY HERE.
  // The block that stood here argued that one exposure base was honest BECAUSE
  // every experience column was already WC — memberExperienceMods called with
  // 'WC', the Exposure cell rendering getMemberExposure(member, 'WC', ...) — and
  // it ended with a warning: "IF THIS PAGE EVER GAINS A LINE SELECTOR, THE
  // HEADER HAS TO MOVE WITH IT. That is the moment the single label becomes a
  // lie, and it will not announce itself."
  //
  // The lie arrived before the selector did. Teams now choose their own lines,
  // so a GL-only pool rendered getMemberExposure(member, 'WC', ...) = 0 for
  // every member under a header reading "Payroll ($M)", and a WC+GL pool showed
  // WC ratios under a Pool heading. The warning was right about the mechanism
  // and wrong only about which end moved first.
  //
  // ⚠ SO THE BASIS NOW FOLLOWS THE LINE, AND THE HEADER MOVES WITH IT. WC and GL
  // are per $100 of PAYROLL; Property is per $100 of TIV. One header over two
  // denominators would be exactly the lie above, so the label is derived from
  // the selected line rather than written once.
  //
  // ⚠ AND ON THE POOL VIEW THE THREE PER-LINE COLUMNS ARE ABSENT, NOT BLANK.
  // '—' is already taken on this table: it means "fewer than the window's years
  // of claims with the pool". A column of dashes would say a rated book is
  // unrated, rather than saying the question has no pool-wide answer. Removing
  // the column says the second thing and cannot be misread as the first.
  //
  // ============================================================================
  // THE BASIS, AND IT IS THE RATIO'S BASIS EXACTLY — same window, same cap.
  //
  //   loss cost = SUM(primaryActual over the window) / SUM(exposure) / 100
  //
  // ⚠ CAPPED PER CLAIM AT EXPERIENCE_SPLIT_POINT, SO IT IS NOT THE MEMBER'S
  // TOTAL COST AND THE HEADER SAYS "limited per claim". The Loss Ratio column
  // reads the capped primary layer; putting an UNCAPPED loss cost beside it
  // would be two columns a reader would divide into each other and get a number
  // that means nothing. On this basis the two are exactly one factor apart —
  // loss cost = ratio x the member's own expected loss cost — which is the
  // comparison the pair is for. The cost of that choice is real and is stated:
  // WC's primary layer is about 17% of ground-up loss, so a member with a $2M
  // claim shows $25k of it here.
  //
  // ⚠ EXPOSURE IS SUMMED OVER THE SAME YEARS, NOT TAKEN AT TODAY'S LEVEL. The
  // ledger does not store exposure, but getMemberExposure is a pure function of
  // the member and the year (exposureByLine x wageFactor), so the window's own
  // exposure is reconstructible exactly rather than approximated by
  // this-year's-times-three.
  //
  // ⚠ AND THE LOSSES ARE AS DRAWN. MemberLossYear.actual is written once, in the
  // accident year, from the generator's result and is never revisited —
  // MEASURED: 6,895 member-years observed at two or more later valuations, ZERO
  // revised, widest drift $0.00, and every row equal to that year's drawn claim
  // total. IBNER development moves the pool's reserves and its triangle; it does
  // not reach this ledger. So both columns, and the renewal threshold that reads
  // one of them, are on inception values. Nobody had stated this.
  // ============================================================================
  const expByMember = React.useMemo(() => {
    const out = new Map<string, { ratio: number | null; lossCost: number | null }>();
    if (!expLine) return out;   // pool view: no per-line record to show
    const mods = memberExperienceMods(activeMembers, expLine, memberLossHistory, displayYear);
    const byId = new Map(activeMembers.map(m => [m.id, m]));
    for (const m of mods) {
      const member = byId.get(m.memberId);
      let lossCost: number | null = null;
      // Gated on `rated` so the two columns are blank together. A loss cost
      // needs no credibility to compute, but showing one where the ratio reads
      // "—" would invite ranking on a record the page has just declined to rate.
      if (member && m.rated) {
        const w = experienceWindow(memberLossHistory, m.memberId, expLine, EXPERIENCE_MOD.windowYears);
        const ap = w.reduce((t, e) => t + e.primaryActual, 0);
        const expo = w.reduce((t, e) => t + getMemberExposure(member, expLine, e.yearNumber), 0);
        if (expo > 0) lossCost = ap / (expo * 10_000);
      }
      out.set(m.memberId, { ratio: m.rawRatio, lossCost });
    }
    return out;
  }, [activeMembers, memberLossHistory, displayYear, expLine]);

  // ⚠ WC AND GL ARE PER $100 OF PAYROLL; PROPERTY IS PER $100 OF TIV. Derived
  // from the selected line rather than written once — see the block above.
  const basis = expLine ? EXPOSURE_BASIS[expLine] : 'Payroll';

  // ⚠ THE TWO EXPOSURE TILES ARE THE ONE PLACE A POOL FIGURE IS NOT MERELY
  // POOLED BUT INCOHERENT, AND THE ENGINE SAYS SO IN SO MANY WORDS:
  // activeExposure and totalMarketExposure at pool scope are
  // "DIMENSIONALLY MEANINGLESS ... pool-scope hazards, not pool-scope facts",
  // kept alive only because display code still reads them — and this page is
  // named in that list.
  //
  // ⚠ BUT THE INCOHERENCE IS CONDITIONAL, SO REMOVING THEM OUTRIGHT WOULD THROW
  // AWAY A GOOD NUMBER. WC and GL are both payroll: a WC+GL pool's sum is
  // payroll plus payroll, which is payroll. Only a pool mixing Property with
  // either of the others adds $M of payroll to $M of TIV. So the tiles show
  // when ONE basis applies and are absent when two do — the same rule the
  // per-line columns follow on the pool view, for the same reason: a figure
  // with no coherent value is better absent than plausible.
  const poolBases = new Set(activeLines.map(l => EXPOSURE_BASIS[l]));
  const exposureBasis: 'Payroll' | 'TIV' | null =
    expLine ? EXPOSURE_BASIS[expLine] : (poolBases.size === 1 ? [...poolBases][0] : null);

  // On the pool view the three per-line columns are gone, so a sort key naming
  // one of them would order the table by a column nobody can see. Fall back to
  // the name rather than silently sorting on an invisible number.
  const effectiveSortKey = (!expLine && (sortKey === 'exposure' || sortKey === 'ratio' || sortKey === 'lossCost'))
    ? 'name' as const
    : sortKey;

  const sortedMembers = [...activeMembers].sort((a, b) => {
    let valA: number | string = 0;
    let valB: number | string = 0;
    if (effectiveSortKey === 'name') { valA = a.name; valB = b.name; }
    else if (effectiveSortKey === 'exposure') { valA = expLine ? getMemberExposure(a, expLine, displayYear) : 0; valB = expLine ? getMemberExposure(b, expLine, displayYear) : 0; }
    else if (effectiveSortKey === 'satisfaction') { valA = satisfactionOf(a); valB = satisfactionOf(b); }
    else if (effectiveSortKey === 'lossCost') {
      // Unrated members sort as 0 rather than as 1 — a blank cell is "no record
      // to cost", not "an average cost", and the ratio's own comparator makes
      // the matching choice for its own scale on the line below.
      valA = expByMember.get(a.id)?.lossCost ?? 0; valB = expByMember.get(b.id)?.lossCost ?? 0;
    }
    else if (effectiveSortKey === 'ratio') {
      // Same convention as the mod column above, and 1 is the right filler on
      // this scale too: the rated ratio's median measures 0.94 on WC.
      valA = expByMember.get(a.id)?.ratio ?? 1; valB = expByMember.get(b.id)?.ratio ?? 1;
    }
    else if (effectiveSortKey === 'yearJoined') { valA = a.yearJoined; valB = b.yearJoined; }

    if (typeof valA === 'string') {
      return sortDir === 'asc' ? valA.localeCompare(valB as string) : (valB as string).localeCompare(valA);
    }
    return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
  });

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const thClass = (key: typeof sortKey) =>
    `px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors ${sortKey === key ? 'text-blue-600 bg-blue-50/50' : 'text-gray-500 hover:text-gray-700'}`;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        {/* ⚠ THE SCOPE IS NAMED ONCE, AT THE TOP, FOR THE WHOLE PAGE. It used to
            be named in a line under the table that said "Experience columns show
            WC" — a disclaimer for the days when those columns were the only
            thing on the page that knew about lines. Everything follows the view
            now, so singling the columns out would imply the rest does not. */}
        <h2 data-testid="membership-scope" className="text-xl font-bold text-gray-900">
          Active Membership{lineView === 'pool' ? '' : ` — ${LINE_FULL_NAME[lineView]}`}
        </h2>
        <p className="text-gray-500 text-sm">
          {last ? `Current membership as of Year ${last.yearNumber} / ${last.calendarYear}` : `Starting membership — ${startingYear}`}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryChip icon={<Users size={16} />} label="Active Members" value={String(activeMembers.length)} />
        <SummaryChip icon={<UserPlus size={16} />} label="New This Year" value={`+${newThisYear}`} valueColor="text-emerald-600" />
        <SummaryChip icon={<UserMinus size={16} />} label="Withdrawn" value={withdrawnThisYear > 0 ? `-${withdrawnThisYear}` : '0'} valueColor={withdrawnThisYear > 0 ? 'text-red-600' : 'text-gray-700'} />
        <SummaryChip icon={<Globe size={16} />} label="Market Share" value={formatPct(marketShare)} valueColor="text-sky-600" />
        <SummaryChip label="Pool Satisfaction" value={`${satisfaction.toFixed(1)} / 10`} />
        <SummaryChip label="Retention" value={formatPct(retentionRate)} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 shadow-sm">
        {exposureBasis && (
          <Metric label={`${exposureBasis} Exposure ($M)`} value={formatMillions(activeExposure)} />
        )}
        {exposureBasis && (
          <Metric label={`Total Market ${exposureBasis} ($M)`} value={formatMillions(totalMarketExposure)} />
        )}
        <Metric label="Avg. Risk Quality" value={`${avgRiskQuality.toFixed(1)} / 10`} />
        <Metric label="Avg. Member Satisfaction" value={`${memberMeanSatisfaction.toFixed(2)} / 10`} />
        {!exposureBasis && (
          <p data-testid="exposure-mixed" className="col-span-2 self-center text-xs text-gray-400">
            Exposure is payroll on WC and GL and insured value on Property; this pool writes both, so there is
            no one figure. Pick a line above.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-blue-600" />
            <h3 className="font-bold text-gray-900">Active Member Roster</h3>
            <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{activeMembers.length}</span>
          </div>
          <p className="text-xs text-gray-400">Click column headers to sort</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className={thClass('name')} onClick={() => handleSort('name')}>Member Name {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Size</th>
                {expLine && (
                  <th className={thClass('exposure')} onClick={() => handleSort('exposure')}>{basis} ($M) {sortKey === 'exposure' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                )}
                <th className={thClass('yearJoined')} onClick={() => handleSort('yearJoined')}>Yr Joined {sortKey === 'yearJoined' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                {expLine && (
                  <th className={thClass('ratio')} onClick={() => handleSort('ratio')} title={`Actual losses over expected on ${expLine}, over the last ${EXPERIENCE_MOD.windowYears} years, limited per claim. What the member cost. This is what Renewal Underwriting acts on.`}>Loss Ratio {sortKey === 'ratio' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                )}
                {expLine && (
                  <th className={thClass('lossCost')} onClick={() => handleSort('lossCost')} title={`The member's own ${expLine} losses per $100 of ${basis.toLowerCase()}, over the last ${EXPERIENCE_MOD.windowYears} years, limited per claim — the same window and the same cap as Loss Ratio, and the same losses as drawn. What the member costs, rather than how they did against their class.`}>Loss Cost /$100 {sortKey === 'lossCost' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                )}
                <th className={thClass('satisfaction')} onClick={() => handleSort('satisfaction')} title="What this member thinks of the pool, 1-10, averaged over the lines they are enrolled in. Two things move it: what the pool's price DID this year against the market, where an ordinary year barely registers and a real move bites; and where the pool's price SITS against what a carrier would charge, which pulls their opinion year after year for as long as it lasts. It is a scoreboard: nothing in the model reads it.">Satisfaction {sortKey === 'satisfaction' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedMembers.map(member => (<MemberRow key={member.id} member={member} displayYear={displayYear} expLine={expLine} satisfaction={satisfactionOf(member)} ratio={expByMember.get(member.id)?.ratio ?? null} lossCost={expByMember.get(member.id)?.lossCost ?? null} />))}
            </tbody>
          </table>
        </div>
        {/* ⚠ ONE LINE. The pair needs exactly one thing said about it on screen —
            which of the two the threshold acts on — and the rest belongs in the
            header tooltips and in the block above expByMember. The class-rate
            reasoning that makes the two orderings differ is deliberately NOT
            here: a player does not need the derivation to use the columns.

            ⚠ AND "rank members differently" IS TRUE BUT SMALLER THAN IT SOUNDS.
            Measured on WC, 6 games x 10 years, Spearman between the two columns
            is 0.955 — they mostly agree, and the 4.5% they do not is the class
            effect. The sentence says "can rank" rather than "rank" for that
            reason. */}
        {expLine ? (
          <p className="px-5 py-2.5 text-[11px] text-gray-500 border-t border-gray-100">
            Loss Ratio and Loss Cost are this member's record on {expLine}. They can rank members differently; Renewal Underwriting acts on the ratio.
          </p>
        ) : (
          /* ⚠ SAID ON SCREEN, NOT ONLY IN THE CODE. The columns vanishing between
             views is otherwise an unexplained reflow, and the reason is the
             interesting part: the numbers are per line because the records are. */
          <p className="px-5 py-2.5 text-[11px] text-gray-500 border-t border-gray-100">
            Exposure, Loss Ratio and Loss Cost are per line — a member has one of each on every line it is enrolled in, not one overall. Choose a line above to see them.
          </p>
        )}
      </div>
      <p className="text-xs text-gray-400 text-center">All member names are fictional. No real public entity names are used.</p>
    </div>
  );
}

function MemberRow({ member, displayYear, expLine, satisfaction, ratio, lossCost }: {
  member: Member; displayYear: number; expLine: CoverageLine | null; satisfaction: number;
  ratio: number | null; lossCost: number | null;
}) {
  // ⚠ THE RATIO'S BANDS ARE ITS OWN, NOT THE MOD'S. Its measured spread is an
  // order of magnitude wider (WC p10 0.24, p90 1.86, max 5.48 against the mod's
  // 0.93 to 1.35), so reusing 0.95/1.05 here would paint most of the book red.
  // Banded on the measured quartiles instead.
  const ratioColor = ratio === null ? 'text-gray-400'
    : ratio <= 0.6 ? 'text-emerald-600' : ratio >= 1.4 ? 'text-red-600' : 'text-gray-700';
  // ⚠ THE COST'S BANDS ARE ITS OWN AGAIN, AND THEY ARE ABSOLUTE DOLLARS RATHER
  // THAN A RATIO, so neither of the two sets above transfers. Banded on the
  // measured quartiles of the shipped column, 6 games x 10 years on WC: p25
  // $0.31, p50 $0.49, p75 $0.70, max $5.77.
  const costColor = lossCost === null ? 'text-gray-400'
    : lossCost <= 0.31 ? 'text-emerald-600' : lossCost >= 0.70 ? 'text-red-600' : 'text-gray-700';
  // ⚠ BANDED ON WHERE MEMBERS START, NOT ON THE 1-10 SCALE'S MIDDLE. The old
  // 7 / 5 thresholds were set when the opening draw spanned 6.0-8.5 and the
  // field never moved. Every member now opens inside OPENING_SATISFACTION's
  // three hundredths, so a fixed 5.0 boundary would never be crossed and the
  // whole column would read one colour forever. These are relative to the
  // opening, and the amber band is three funding decisions wide (3 x 0.058,
  // the measured footprint of one) so red means a member has lost more than a
  // few decisions' worth of goodwill rather than more than half a scale.
  const satColor = satisfaction >= OPENING_SATISFACTION.min ? 'text-emerald-600'
    : satisfaction >= OPENING_SATISFACTION.min - 0.18 ? 'text-amber-600' : 'text-red-600';

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 font-medium text-gray-900">{member.name}</td>
      <td className="px-4 py-3 text-gray-600"><span className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full whitespace-nowrap">{member.type}</span></td>
      <td className="px-4 py-3 text-gray-600"><SizeBadge size={member.sizeCategory} /></td>
      {expLine && (
        <td className="px-4 py-3 font-mono text-gray-800">{formatMillions(getMemberExposure(member, expLine, displayYear))}</td>
      )}
      <td className="px-4 py-3 text-gray-600">{member.calendarYearJoined > 0 ? member.calendarYearJoined : '—'}</td>
      {expLine && (
        <td className={`px-4 py-3 font-semibold ${ratioColor}`} title={ratio === null ? `Fewer than ${EXPERIENCE_MOD.windowYears} years of claims with the pool` : undefined}>
          {ratio === null ? '—' : `${ratio.toFixed(2)}x`}
        </td>
      )}
      {expLine && (
        <td className={`px-4 py-3 font-semibold ${costColor}`} title={lossCost === null ? `Fewer than ${EXPERIENCE_MOD.windowYears} years of claims with the pool` : undefined}>
          {lossCost === null ? '—' : `$${lossCost.toFixed(2)}`}
        </td>
      )}
      {/* TWO DECIMALS, BECAUSE THE STOCK MOVES IN HUNDREDTHS. A year's move at
          the shipped weight is a few hundredths; displayed to one decimal most
          years would read as no change at all and the rebuilt field would look
          exactly as frozen as the one it replaces. See memberSatisfaction.ts. */}
      <td className={`px-4 py-3 font-semibold ${satColor}`}>{satisfaction.toFixed(2)}</td>
      <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${member.status === 'active' ? 'bg-emerald-100 text-emerald-700' : member.status === 'withdrawn' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{member.status}</span></td>
    </tr>
  );
}

function SizeBadge({ size }: { size: string }) {
  const cls = size === 'Very Large' ? 'bg-purple-100 text-purple-700' : size === 'Large' ? 'bg-blue-100 text-blue-700' : size === 'Medium' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{size}</span>;
}

function SummaryChip({ icon, label, value, valueColor = 'text-gray-900' }: { icon?: React.ReactNode; label: string; value: string; valueColor?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col items-center shadow-sm text-center">
      {icon && <span className="text-gray-400 mb-1">{icon}</span>}
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className={`text-lg font-bold ${valueColor}`}>{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className="text-base font-bold text-gray-900">{value}</p>
    </div>
  );
}