/**
 * Format a byte count with comma thousands separators.
 * Example: 12345678 -> "12,345,678"
 */
export function formatBytesWithCommas(
  value: number | null | undefined,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  const integerValue = Math.trunc(value);
  const isNegative = integerValue < 0;
  const absValue = Math.abs(integerValue);
  const formatted = absValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return isNegative ? `-${formatted}` : formatted;
}
