import React, { useState } from 'react';
import { Users, UserPlus, UserMinus, Globe } from 'lucide-react';
import type { ResultSet, Member, StartingFinancials, MemberLossHistory } from '../types/simulation';
import { formatMillions, formatPct } from '../utils/formatters';
import { getMemberExposure } from '../utils/lineHelpers';
import { EXPERIENCE_MOD, displayedMod, medianRatedMod, memberExperienceMods } from '../utils/memberExperienceMod';

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
}

export default function MembershipPage({ lockedResults, startingFinancials, initialMembers, startingYear, memberLossHistory }: MembershipPageProps) {
  // Exposure is DISPLAYED NOMINAL — in the dollars of the latest completed year,
  // matching the premium and member charge shown elsewhere. Roster payroll is
  // frozen in year-1 dollars; wageFactor carries it forward. See lineHelpers.
  const displayYear = lockedResults.length > 0 ? lockedResults[lockedResults.length - 1].yearNumber : 1;
  // ⚠ 'riskQuality' IS GONE FROM THIS UNION AND THAT IS LOAD-BEARING. Risk
  // quality is no longer shown per member anywhere, so there is nothing to
  // sort by; leaving the key would let a future column reintroduce the
  // attribute with a one-word change. surface-privacy-check asserts the
  // absence across every page and export.
  const [sortKey, setSortKey] = useState<'name' | 'exposure' | 'satisfaction' | 'ratio' | 'mod' | 'yearJoined'>('exposure');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const last = lockedResults[lockedResults.length - 1];

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
  // ⚠ AND THE ROSTER'S SATISFACTION IS THE FIRST ACTIVE LINE'S. Satisfaction is
  // per member per line — the drivers are a bill on one line — while
  // Member.satisfaction is one field, so processYear's roster fold keeps the
  // first line's copy exactly as it folds `status`. This page is already a WC
  // view (payroll, loss ratio and mod are all WC), so on any pool writing WC the
  // column matches the page. On a pool without WC it is whichever line comes
  // first in activeLines.
  const memberMeanSatisfaction = activeMembers.length > 0
    ? activeMembers.reduce((s, m) => s + m.satisfaction, 0) / activeMembers.length
    : satisfaction;

  const expByMember = React.useMemo(() => {
    const mods = memberExperienceMods(activeMembers, 'WC', memberLossHistory, displayYear);
    const median = medianRatedMod(mods);
    const out = new Map<string, { ratio: number | null; mod: number | null }>();
    for (const m of mods) out.set(m.memberId, { ratio: m.rawRatio, mod: displayedMod(m, median) });
    return out;
  }, [activeMembers, memberLossHistory, displayYear]);

  const sortedMembers = [...activeMembers].sort((a, b) => {
    let valA: number | string = 0;
    let valB: number | string = 0;
    if (sortKey === 'name') { valA = a.name; valB = b.name; }
    else if (sortKey === 'exposure') { valA = getMemberExposure(a, 'WC', displayYear); valB = getMemberExposure(b, 'WC', displayYear); }
    else if (sortKey === 'satisfaction') { valA = a.satisfaction; valB = b.satisfaction; }
    else if (sortKey === 'mod') {
      // Unrated members sort as if typical rather than as 0, so a book with
      // few rated members does not stack every newcomer at one end.
      valA = expByMember.get(a.id)?.mod ?? 1; valB = expByMember.get(b.id)?.mod ?? 1;
    }
    else if (sortKey === 'ratio') {
      // Same convention as the mod column above, and 1 is the right filler on
      // this scale too: the rated ratio's median measures 0.94 on WC.
      valA = expByMember.get(a.id)?.ratio ?? 1; valB = expByMember.get(b.id)?.ratio ?? 1;
    }
    else if (sortKey === 'yearJoined') { valA = a.yearJoined; valB = b.yearJoined; }

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
        <h2 className="text-xl font-bold text-gray-900">Active Membership</h2>
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
        <Metric label="Payroll Exposure ($M)" value={formatMillions(activeExposure)} />
        <Metric label="Total Market Payroll ($M)" value={formatMillions(totalMarketExposure)} />
        <Metric label="Avg. Risk Quality" value={`${avgRiskQuality.toFixed(1)} / 10`} />
        <Metric label="Avg. Member Satisfaction" value={`${memberMeanSatisfaction.toFixed(2)} / 10`} />
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
                <th className={thClass('exposure')} onClick={() => handleSort('exposure')}>Payroll ($M) {sortKey === 'exposure' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={thClass('yearJoined')} onClick={() => handleSort('yearJoined')}>Yr Joined {sortKey === 'yearJoined' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={thClass('ratio')} onClick={() => handleSort('ratio')} title={`Actual losses over expected, over the last ${EXPERIENCE_MOD.windowYears} years, limited per claim. What the member cost. This is what Renewal Underwriting acts on.`}>Loss Ratio {sortKey === 'ratio' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={thClass('mod')} onClick={() => handleSort('mod')} title="What the member is charged for that record, credibility-weighted against their class. 1.00 is the typical member. Much flatter than the ratio by design — most of a member's rate is their class, not their own claims.">Experience Mod {sortKey === 'mod' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className={thClass('satisfaction')} onClick={() => handleSort('satisfaction')} title="What this member thinks of the pool, 1-10. It moves each year on their own bill measured against what the market's rate did, damped by how much their own claims explain the increase. It is a scoreboard: nothing in the model reads it.">Satisfaction {sortKey === 'satisfaction' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedMembers.map(member => (<MemberRow key={member.id} member={member} displayYear={displayYear} ratio={expByMember.get(member.id)?.ratio ?? null} mod={expByMember.get(member.id)?.mod ?? null} />))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center">All member names are fictional. No real public entity names are used.</p>
    </div>
  );
}

function MemberRow({ member, displayYear, ratio, mod }: {
  member: Member; displayYear: number; ratio: number | null; mod: number | null;
}) {
  // Below 1 is a credit and reads green; above 1 is a debit. Deliberately the
  // SAME direction as the loss ratio elsewhere on this app — lower is better —
  // rather than risk quality's old convention where higher was better.
  const modColor = mod === null ? 'text-gray-400'
    : mod <= 0.95 ? 'text-emerald-600' : mod >= 1.05 ? 'text-red-600' : 'text-gray-700';
  // ⚠ THE RATIO'S BANDS ARE ITS OWN, NOT THE MOD'S. Its measured spread is an
  // order of magnitude wider (WC p10 0.24, p90 1.86, max 5.48 against the mod's
  // 0.93 to 1.35), so reusing 0.95/1.05 here would paint most of the book red.
  // Banded on the measured quartiles instead.
  const ratioColor = ratio === null ? 'text-gray-400'
    : ratio <= 0.6 ? 'text-emerald-600' : ratio >= 1.4 ? 'text-red-600' : 'text-gray-700';
  const satColor = member.satisfaction >= 7 ? 'text-emerald-600' : member.satisfaction >= 5 ? 'text-amber-600' : 'text-red-600';

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 font-medium text-gray-900">{member.name}</td>
      <td className="px-4 py-3 text-gray-600"><span className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full whitespace-nowrap">{member.type}</span></td>
      <td className="px-4 py-3 text-gray-600"><SizeBadge size={member.sizeCategory} /></td>
      <td className="px-4 py-3 font-mono text-gray-800">{formatMillions(getMemberExposure(member, 'WC', displayYear))}</td>
      <td className="px-4 py-3 text-gray-600">{member.calendarYearJoined > 0 ? member.calendarYearJoined : '—'}</td>
      <td className={`px-4 py-3 font-semibold ${ratioColor}`} title={ratio === null ? `Fewer than ${EXPERIENCE_MOD.windowYears} years of claims with the pool` : undefined}>
        {ratio === null ? '—' : `${ratio.toFixed(2)}x`}
      </td>
      <td className={`px-4 py-3 font-semibold ${modColor}`} title={mod === null ? `Fewer than ${EXPERIENCE_MOD.windowYears} years of claims with the pool` : undefined}>
        {mod === null ? '—' : mod.toFixed(2)}
      </td>
      {/* TWO DECIMALS, BECAUSE THE STOCK MOVES IN HUNDREDTHS. A year's move at
          the shipped weight is a few hundredths; displayed to one decimal most
          years would read as no change at all and the rebuilt field would look
          exactly as frozen as the one it replaces. See memberSatisfaction.ts. */}
      <td className={`px-4 py-3 font-semibold ${satColor}`}>{member.satisfaction.toFixed(2)}</td>
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