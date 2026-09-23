// ============================================================================
// THE RISK CONTROL DEPARTMENT'S MEMO.
//
// Built rather than stored as a .md file, for one reason: THE PROGRAM LIST IS
// GATED BY THE LINES THE POOL WRITES. investmentMemo.md can be static because it
// says the same thing to every pool; this cannot, because its own second
// paragraph promises that line-specific programs only appear if the pool
// provides that coverage. A static file would have to either list all five (and
// contradict itself) or drop the sentence.
//
// ⚠ THE PROSE BELOW IS THE USER'S, VERBATIM. It is not summarised, reordered or
// annotated, and nothing of this file's own is mixed into it. If it needs to
// change, it changes because the author changed it.
//
// ⚠ AND THE PROGRAM DESCRIPTIONS ARE NOT HERE YET. The brief that supplied this
// copy said "[The five program descriptions follow, supplied separately]" and
// they were not included. They are NOT invented here and the catalog's own
// `what`/`why` are NOT substituted for them — that would put this file's prose
// next to the author's under the same heading, which is the one thing the brief
// ruled out. Each program renders its NAME, LINE and TERM, which are facts from
// the catalog, and the description slot is where the supplied text lands. That
// is a drop-in: see PROGRAM_BODY below.
// ============================================================================

import type { CoverageLine } from '../types/simulation';
import { availableCategories, commitmentLabel, type RiskControlCategory } from '../data/riskControlCategories';

/** The supplied heading and preamble, verbatim. */
const PREAMBLE = `# Risk Control Investment Options

Each term, the Risk Control Department will present programs available for management consideration. Some programs are designed for a specific coverage line, while others can benefit the Pool as a whole.

Programs affecting an individual coverage line will only be available if your Pool provides that coverage.

Risk control programs may differ in cost, duration, and timing of their expected benefits. Some can begin affecting results relatively quickly, while others require a multi-year commitment before their full value is realized.`;

/**
 * One program's block. The description slot is deliberately empty until the
 * supplied text arrives — when it does, it goes here and nothing else moves.
 */
function PROGRAM_BODY(c: RiskControlCategory): string {
  const line = c.scope === 'Pool' ? 'Pool-wide' : c.scope;
  return `## ${c.name}\n\n**${line}** · **${commitmentLabel(c)}**\n`;
}

export function buildRiskControlMemo(activeLines: readonly CoverageLine[]): string {
  const available = availableCategories(activeLines);
  return [PREAMBLE, ...available.map(PROGRAM_BODY)].join('\n\n');
}
