import type { Totals } from '../shared/types.ts';

/**
 * Format a token count for compact dashboard labels.
 * @param value Number of tokens to display.
 * @returns Localized count with a compact suffix when appropriate.
 */
export function compact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(value);
}

/**
 * Format a monetary subtotal in US dollars.
 * @param value Dollar amount to display.
 * @returns Currency label rounded to two decimal places.
 */
export function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a fraction as a percentage.
 * @param value Fraction, where one represents 100 percent.
 * @returns Percentage label with one decimal place.
 */
export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Check whether a subtotal has any priced requests, treating empty periods as zero.
 * @param value Request counts for a total, breakdown, or chart point.
 * @returns True when displaying a monetary subtotal is meaningful.
 */
export function hasPrice(value: Pick<Totals, 'requests' | 'unpriced'>): boolean {
  return value.requests === 0 || value.unpriced < value.requests;
}

/**
 * Label a priced subtotal without presenting unknown costs as free.
 * @param value Monetary subtotal and its request counts.
 * @returns USD label, or Unpriced when no request has a known cost.
 */
export function costLabel(value: Pick<Totals, 'cost' | 'requests' | 'unpriced'>): string {
  return hasPrice(value) ? money(value.cost) : 'Unpriced';
}

/**
 * Format a local calendar-day key without shifting it across timezone boundaries.
 * @param value Date in YYYY-MM-DD form.
 * @returns Abbreviated month and day label.
 */
export function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
