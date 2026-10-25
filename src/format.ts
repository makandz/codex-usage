export const compact = (value: number) => new Intl.NumberFormat('en-US', {
  notation: 'compact', maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
}).format(value);
export const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);
