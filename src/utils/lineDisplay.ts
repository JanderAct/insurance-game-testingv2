import type { CoverageLine, LineView } from '../types/simulation';

// Full names for USER-FACING text only (headers, labels, tooltips, decision
// history, comparison views, tab row). Internal identifiers — CoverageLine
// values, byLine keys, RNG labels, xlsx tab names/filenames — are untouched;
// those keep the short WC/GL/Property (PR) convention (see resultsExport.ts).
export const LINE_FULL_NAME: Record<CoverageLine, string> = {
  WC: "Workers' Compensation",
  GL: 'General Liability',
  Property: 'Property',
};

export function lineDisplayName(view: LineView): string {
  return view === 'pool' ? 'Pool' : LINE_FULL_NAME[view];
}
