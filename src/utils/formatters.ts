// Display formatting utilities

export function formatCurrency(value: number, compact = false): string {
  if (compact) {
    if (Math.abs(value) >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`;
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

export function formatPct(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals = 1): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatRatio(value: number): string {
  return value.toFixed(3);
}

export function colorForRatio(ratio: number): string {
  if (ratio < 0.90) return 'text-emerald-600';
  if (ratio < 1.00) return 'text-sky-600';
  if (ratio < 1.10) return 'text-amber-600';
  return 'text-red-600';
}

export function colorForSurplus(surplus: number): string {
  if (surplus > 0) return 'text-emerald-600';
  return 'text-red-600';
}

export function colorForNetIncome(income: number): string {
  if (income >= 0) return 'text-emerald-600';
  return 'text-red-600';
}

export function colorForFunding(indicator: string): string {
  if (indicator === 'Adequate') return 'text-emerald-600';
  if (indicator === 'Marginal') return 'text-amber-600';
  return 'text-red-600';
}

export function badgeForFunding(indicator: string): string {
  if (indicator === 'Adequate') return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
  if (indicator === 'Marginal') return 'bg-amber-100 text-amber-700 border border-amber-200';
  return 'bg-red-100 text-red-700 border border-red-200';
}