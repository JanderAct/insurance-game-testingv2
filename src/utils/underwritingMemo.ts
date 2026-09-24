// ============================================================================
// THE UNDERWRITING DEPARTMENT'S MEMO — who wants in, and who would go.
//
// INFORMATIONAL, NOT A CONTROL. The same division Claims already draws: the
// LISTING is a department page, the THRESHOLD is a decision on the Decisions
// tab. There is no per-applicant accept or decline here and this must not grow
// one — the pool underwrites against a standard, it does not work a queue.
//
// ⚠ ONE PAGE PER LINE, TWO SECTIONS, AND THE ONE PAGE IS THE POINT. A player
// should be able to see that they are turning away a candidate with a better
// loss run than a member they are renewing. Split across two documents that
// comparison disappears, so both sections carry the SAME columns even where one
// side could carry more — see the column note below.
//
// ============================================================================
// ⚠ "WHO WANTS IN" IS A CANDIDATE LIST, NOT THIS YEAR'S APPLICANTS, AND THE
// DIFFERENCE IS NOT COSMETIC — THIS YEAR'S APPLICANTS DO NOT EXIST TO BE SHOWN.
//
// WHICH members apply is DRAWN inside processYear: membershipEngine shuffles the
// available pool and takes a prefix (`shuffledPool.slice(0, applicationCount)`).
// Only `applicantCount` survives onto the result — the ids are never stored, on
// the same rule declined members follow. So before a year is locked the
// applicant identities do not exist, and after it is locked they are gone.
// DecisionsPage's own header says the same thing about the appetite tiles:
// "share x applications is the expected eligible count, NOT this year's actual".
//
// What this section lists instead is the AVAILABLE POOL — the marketplace, minus
// the enrolled, minus anyone inside the re-enrolment cooldown. That is the set
// the threshold actually acts on, it is a pure filter rather than a draw, and it
// is therefore the same on every render of the same game state. A drawn list
// would not be reproducible and could not be fingerprinted at all.
//
// ⚠ SO THE ROW COUNT IS NOT THE JOINER COUNT, AND THE PAGE SAYS SO TWICE. Both
// numbers are printed in the section's opening line: how many COULD apply, and
// how many are EXPECTED to. A reader who counts the rows and expects that many
// joiners is reading it wrong, and the heading is written to stop them.
//
// ⚠ AND THE ORDER IS NEUTRAL ON PURPOSE. Sorted BY NAME, not best-to-worst.
// Sorting by loss ratio would imply a ranking the engine does not perform:
// applicants are written in the order they come, and the pool underwrites
// against a standard rather than cherry-picking the queue. A page that ranks
// them teaches the opposite of the mechanic. "Who would go" is sorted by name
// too, so the two sections read the same way and neither implies a priority.
//
// ============================================================================
// ⚠ THE COLUMNS ARE THE SAME ON BOTH SIDES, AND TWO ASKED-FOR COLUMNS ARE NOT
// HERE. Claim count and a ">$1M" flag were both wanted. Neither can be shown
// for a candidate, at all:
//
//   MemberLossYear carries exactly five fields — yearNumber, actual,
//   expectedAtOwnRq, expectedAtManual, primaryActual. No claim count, no
//   per-claim amounts. Per-claim data exists ONLY in the pool's own register
//   (LineResultSet.claims), which covers enrolled members; a prospect's claims
//   are generated and then discarded, because they "feed nothing" but history.
//
// They could have been shown for MEMBERS alone. They are not, because a member
// row carrying a claim count and $1M flags beside a candidate row carrying
// neither is not a comparison — and the comparison is the reason both sections
// share a page. Dropped for symmetry, not omitted by oversight.
//
// ⚠ AND primaryActual IS NOT A $1M MARKER. actual - primaryActual is non-zero
// whenever a year contained a claim over EXPERIENCE_SPLIT_POINT, which is
// $25,000 — the experience split, not a retention. It says nothing about
// whether the tower paid, so it is not used as a stand-in for the flag that was
// wanted.
//
// ⚠ WHAT IS SHOWN INSTEAD OF A RATIO COLUMN PER ROW. The window ratio the
// threshold acts on is over EXPERIENCE_MOD.windowYears, currently 3. The loss
// run prints FIVE years because LOSS_HISTORY_CAP_YEARS stores five, and the two
// extra years are the interesting part: a candidate can look clean on the bar's
// three-year window and carry a terrible fourth year the bar cannot see. The
// per-year A/E is printed so that gap is visible rather than implied.
// ============================================================================

import type {
  CoverageLine, GameState, Member, MemberLossHistory, MemberLossYear,
} from '../types/simulation';
import { getMemberExposure } from './lineHelpers';
import { canReenroll } from './membershipHistory';
import { memberExperienceMods, EXPERIENCE_MOD, CREDIBILITY_Z } from './memberExperienceMod';
import { LOSS_HISTORY_CAP_YEARS } from './memberLossHistory';
import { APPLICATION_RATE } from '../data/defaultAssumptions';
import { lineDisplayName } from './lineDisplay';

const money = (n: number): string =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;

const byName = (a: Member, b: Member): number => a.name.localeCompare(b.name);

/**
 * ⚠ EXPOSURE IS IN MILLIONS AND THE FIRST VERSION OF THIS FILE PRINTED IT RAW.
 * instanceGenerator's own first line says "Exposure = payroll in millions of
 * dollars", so a member on 5.462 carries $5.46M of payroll — and the loss run
 * rendered it as "$5", beside incurred figures in real dollars. Two columns in
 * different units, side by side, both formatted as money. Caught by reading the
 * output rather than by any check, which is the whole argument for having read
 * it.
 */
const exposureDollars = (v: number): number => v * 1e6;

/** One member's loss run: the stored years, oldest first. Same shape both sides. */
function lossRun(
  member: Member, line: CoverageLine, history: MemberLossHistory,
): string {
  const years: MemberLossYear[] = (history[member.id]?.[line] ?? [])
    .slice()
    .sort((a, b) => a.yearNumber - b.yearNumber);
  if (years.length === 0) return '_No loss history on record._\n';
  const rows = years.map(y => {
    const exposure = exposureDollars(getMemberExposure(member, line, y.yearNumber));
    const ae = y.expectedAtManual > 0 ? (y.actual / y.expectedAtManual).toFixed(2) : '—';
    return `| ${y.yearNumber} | ${money(exposure)} | ${money(y.actual)} | ${money(y.expectedAtManual)} | ${ae} |`;
  });
  return ['| Year | Exposure | Incurred | Expected | A/E |', '|---|---:|---:|---:|---:|', ...rows].join('\n') + '\n';
}

function section(
  title: string, lead: string, entries: { member: Member; note: string }[],
  line: CoverageLine, history: MemberLossHistory,
): string {
  const parts = [`### ${title}`, '', lead, ''];
  if (entries.length === 0) {
    parts.push('_None._', '');
    return parts.join('\n');
  }
  for (const { member, note } of entries) {
    parts.push(`**${member.name}** — ${member.type}, ${member.sizeCategory}${note}`, '');
    parts.push(lossRun(member, line, history));
  }
  return parts.join('\n');
}

export function buildUnderwritingMemo(gameState: GameState): string {
  const { poolState, setup, currentYearNumber, currentDecisions } = gameState;
  const history = poolState.memberLossHistory ?? {};
  const out: string[] = [
    '# Underwriting',
    '',
    'Who is available to join, and who the current renewal bar would decline. '
    + 'This is a listing, not a control: the bar itself is set on the Decisions tab.',
    '',
  ];

  for (const line of setup.activeLines) {
    // ⚠ PROPERTY HAS NEITHER HALF OF THIS PAGE, AND SAYS SO RATHER THAN
    // RENDERING TWO EMPTY LISTS. Measured, both legs are absent:
    //
    //   NO CANDIDATE LOSS RUNS. The marketplace-wide loss ledger carries WC and
    //   GL for all 200 entities but Property for only the 70 ENROLLED — a
    //   Property prospect has no stored history, so every candidate row would
    //   print "no loss history on record".
    //   NOBODY OVER THE BAR, EVER. CREDIBILITY_Z is 0 on Property, so no member
    //   is rated and rawRatio is null for all of them; the decline list is
    //   structurally empty whatever the threshold is set to.
    //
    // Listing names with blank runs beside an empty decline section would read
    // as "this pool has no candidates and no problems", which is the opposite of
    // the truth. This is the same statement DecisionsPage already makes on both
    // Property controls, in the same terms, so the two screens agree.
    if ((CREDIBILITY_Z[line] ?? 0) <= 0) {
      out.push(`## ${lineDisplayName(line)}`, '',
        'Not available on Property. A typical member has about one property claim every other year — '
        + 'fewer than two in a three-year record — so a quiet stretch cannot be told apart from a safe '
        + 'one. No member is experience-rated, no loss ratio is shown, and the renewal bar declines '
        + 'nobody. Candidates are not listed with loss runs because a Property prospect has none on '
        + 'record: the marketplace-wide ledger carries Workers\' Compensation and General Liability for '
        + 'every entity, and Property only for those already enrolled.', '');
      continue;
    }
    const lineState = poolState.lines[line];
    const members = lineState.members;
    const enrolled = new Set(members.map(m => m.id));
    const available = poolState.allMarketMembers.filter(
      m => !enrolled.has(m.id)
        && canReenroll(poolState.membershipHistory, m.id, line, currentYearNumber)
        && getMemberExposure(m, line, currentYearNumber) > 0,
    );
    // The engine's own deterministic count — round(pool x rate) — not a draw.
    const expectedApplicants = Math.min(
      available.length, Math.round(available.length * APPLICATION_RATE),
    );

    out.push(`## ${lineDisplayName(line)}`, '');

    out.push(section(
      'Who wants in',
      `**${available.length}** entities could apply this year; about **${expectedApplicants}** are `
      + `expected to. This is the candidate list, not a queue — which of them apply is drawn when the `
      + `year is processed, and the pool writes whoever clears the bar in the order they arrive rather `
      + `than ranking them. Listed alphabetically for that reason. `
      + `Loss runs show the ${LOSS_HISTORY_CAP_YEARS} stored years; the renewal and appetite bars read `
      + `the most recent ${EXPERIENCE_MOD.windowYears}.`,
      available.slice().sort(byName).map(m => ({ member: m, note: '' })),
      line, history,
    ));

    const threshold = currentDecisions.byLine[line]?.renewalThreshold ?? null;
    const mods = memberExperienceMods(members, line, history, currentYearNumber);
    const overBar = threshold === null || !(threshold > 0)
      ? []
      : mods
        .filter(m => m.rated && m.rawRatio !== null && m.rawRatio > threshold)
        .map(m => ({ mod: m, member: members.find(x => x.id === m.memberId) }))
        .filter((x): x is { mod: typeof mods[number]; member: Member } => x.member !== undefined);

    // ⚠ EVERY FOUNDING MEMBER SHARES ONE SYNTHETIC START YEAR, so this figure
    // is IDENTICAL for all of them and only distinguishes members who joined
    // during play. instanceGenerator opens the whole opening roster at
    // `firstYearNumber` — measured, that is -9 for all 65 WC founders — so a
    // year-3 page reads "13 years in the pool" for every one of them. That is
    // arithmetically right and informationally empty, and it is left in because
    // it DOES separate a member who joined in year 2 from the founding book,
    // which is the comparison the section is for. It is not evidence of a
    // thirteen-year pool history.
    const tenure = (m: Member): string => {
      const intervals = poolState.membershipHistory[m.id]?.[line] ?? [];
      const open = intervals.find(i => i.endYear === null);
      if (!open) return '';
      const yrs = currentYearNumber - open.startYear + 1;
      return `, ${yrs} year${yrs === 1 ? '' : 's'} in the pool`;
    };

    out.push(section(
      'Who would go',
      threshold === null || !(threshold > 0)
        ? 'The renewal bar is set to renew every member, so nobody would be declined this year.'
        : `Members whose ${EXPERIENCE_MOD.windowYears}-year loss ratio is above the current bar of `
          + `**${threshold.toFixed(2)}x**. Listed alphabetically, like the candidates above, so the two `
          + `sections can be read against each other.`,
      overBar
        .sort((a, b) => byName(a.member, b.member))
        .map(({ mod, member }) => ({
          member,
          note: `${tenure(member)} — ratio **${(mod.rawRatio ?? 0).toFixed(2)}x**`,
        })),
      line, history,
    ));
  }

  return out.join('\n');
}
