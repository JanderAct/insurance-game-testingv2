// Display formatting utilities

export function formatCurrency(value: number, compact = false): string {
  if (compact) {
    if (Math.abs(value) >= 1_000_000) {
      const millions = value / 1_000_000;
      // Round before comparing so a value just under $1B (e.g. 999,999,999)
      // doesn't display as "$1000.00M" instead of correctly bumping to B.
      if (Math.abs(Number(millions.toFixed(2))) >= 1000) {
        return `$${(value / 1_000_000_000).toFixed(2)}B`;
      }
      return `$${millions.toFixed(2)}M`;
    }
    if (Math.abs(value) >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`;
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// For figures already expressed in millions (payroll/TIV exposure). Rolls up
// to billions at 1000M ($1B) so a large exposure figure doesn't display as an
// unreadable 4+ digit millions number — e.g. "$4177.95M" becomes "$4.18B".
// Below $1B, formatting is unchanged from the plain "$X.XXM" convention.
export function formatMillions(valueInMillions: number, decimals = 2): string {
  // Round before comparing so a value just under 1000M doesn't display as
  // "$1000.00M" instead of correctly bumping to B.
  if (Math.abs(Number(valueInMillions.toFixed(decimals))) >= 1000) {
    return `$${(valueInMillions / 1000).toFixed(decimals)}B`;
  }
  return `$${valueInMillions.toFixed(decimals)}M`;
}

export function formatPct(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

// ONE set of loss-ratio bands, two palettes. The header sits on a dark slate
// bar and needs -400 shades for contrast while the pages use -600 on white, so
// the two cannot share a class string — but they MUST share the cutoffs. The
// header previously inlined its own three-band scale (<0.90 / <1.10) against
// this four-band one, so a 0.95 loss ratio rendered amber in the header and
// sky on the dashboard, on the same screen, for the same number.
function ratioBand(ratio: number): 0 | 1 | 2 | 3 {
  if (ratio < 0.90) return 0;
  if (ratio < 1.00) return 1;
  if (ratio < 1.10) return 2;
  return 3;
}

export function colorForRatio(ratio: number): string {
  return ['text-emerald-600', 'text-sky-600', 'text-amber-600', 'text-red-600'][ratioBand(ratio)];
}

// Same bands as colorForRatio, lightened for the dark header bar.
export function colorForRatioOnDark(ratio: number): string {
  return ['text-emerald-400', 'text-sky-400', 'text-amber-400', 'text-red-400'][ratioBand(ratio)];
}

export function colorForSurplus(surplus: number): string {
  if (surplus > 0) return 'text-emerald-600';
  return 'text-red-600';
}

export function colorForNetIncome(income: number): string {
  if (income >= 0) return 'text-emerald-600';
  return 'text-red-600';
}

