/**
 * Format a raw metric value for display: thousands separators for large
 * numbers (a cumulative counter can run into the millions), fewer decimals
 * as the value gets bigger so it doesn't look like noise.
 */
export function formatNumeric(val: number): string {
  if (Math.abs(val) >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(val) >= 10) return val.toFixed(1);
  return val.toFixed(2);
}
