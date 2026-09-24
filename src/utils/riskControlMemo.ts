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
// ⚠ THE DESCRIPTIONS ARRIVED AND THEY ARE IN riskControlProgramCopy.ts, VERBATIM.
// This file does not add a line of its own to them. It no longer emits the
// generated "line · term" header it carried while the copy was missing, because
// each supplied description opens with its own name, "Applies to:" and
// "Commitment:" — keeping both would have printed the same two facts twice.
//
// ⚠ THE ONE TRANSFORM, AND IT IS LAYOUT NOT EDITING. Markdown folds consecutive
// lines into one paragraph, so "Applies to:" and "Commitment:" — written on
// their own lines — would render as a single run-on line. Every single newline
// becomes a markdown hard break so the copy lays out as written. Blank-line
// paragraph breaks are left alone, and the first line becomes the section
// heading. No word, order or punctuation is touched.
//
// ⚠ COST IS DELIBERATELY NOT HERE. It is shown on the decision tiles, which is
// where the brief put it. Adding a price line to these sections would be adding
// this file's own content alongside the author's, under the author's heading.
// ============================================================================

import type { CoverageLine } from '../types/simulation';
import { availableCategories, type RiskControlCategory } from '../data/riskControlCategories';
import { RISK_CONTROL_PROGRAM_COPY } from '../data/riskControlProgramCopy';

/** The supplied heading and preamble, verbatim. */
const PREAMBLE = `# Risk Control Investment Options

Each term, the Risk Control Department will present programs available for management consideration. Some programs are designed for a specific coverage line, while others can benefit the Pool as a whole.

Programs affecting an individual coverage line will only be available if your Pool provides that coverage.

Risk control programs may differ in cost, duration, and timing of their expected benefits. Some can begin affecting results relatively quickly, while others require a multi-year commitment before their full value is realized.`;

/** One program's block: the supplied description, its first line as a heading. */
function PROGRAM_BODY(c: RiskControlCategory): string {
  const copy = RISK_CONTROL_PROGRAM_COPY[c.id];
  if (!copy) {
    // A category with no supplied description is an authoring gap, not a case
    // to paper over with generated prose. Say which one, on the page.
    return `## ${c.name}\n\n_No description has been supplied for this program._\n`;
  }
  const [heading, ...rest] = copy.split('\n');
  // Single newlines -> markdown hard breaks; blank lines stay paragraph breaks.
  const body = rest.join('\n').replace(/([^\n])\n(?!\n)/g, '$1  \n');
  return `## ${heading}\n${body}`;
}

export function buildRiskControlMemo(activeLines: readonly CoverageLine[]): string {
  const available = availableCategories(activeLines);
  return [PREAMBLE, ...available.map(PROGRAM_BODY)].join('\n\n');
}
