import type {
  ITelemetryField as TelemetryField,
} from "../../../../data-sources/telemetry";

type NumericValue = number | bigint;

/**
 * Produce a compact, human-readable string for numeric telemetry values.
 *
 * @param value - The numeric value to format; accepts `number` or `bigint`.
 * @returns A string representation: bigints as decimal strings, non-finite numbers as their string form, integers without fractional digits, and finite non-integers rounded to 1–3 decimal places based on magnitude (1 decimal if |value|≥100, 2 if |value|≥10, otherwise 3).
 */
export function formatNumberSmart(value: NumericValue): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (!isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return value.toFixed(decimals);
}

/**
 * Format a numeric telemetry value and append its enum label when available.
 *
 * @param field - Optional telemetry field whose `enum_values` may provide a matching name for `value`
 * @param value - The numeric value (number or bigint) to format
 * @returns The string representation of `value`; if `field.enum_values` contains an entry matching `value`, the entry's name is appended in parentheses (e.g., `42 (OK)`)
 */
export function formatEnumNumber(
  field: TelemetryField | undefined,
  value: NumericValue
): string {
  const formatted = formatNumberSmart(value);
  if (!field?.enum_values || field.enum_values.length === 0) {
    return formatted;
  }

  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (Number.isSafeInteger(asNumber)) {
      const match = field.enum_values.find(
        (entry) => entry.value === asNumber
      );
      return match ? `${formatted} (${match.name})` : formatted;
    }
    return formatted;
  }

  const match = field.enum_values.find((entry) => entry.value === value);
  return match ? `${formatted} (${match.name})` : formatted;
}

/**
 * Create a compact preview string for an array of values, annotating numeric entries with enum names when available.
 *
 * @param field - Optional telemetry field used to resolve numeric enum names for formatting
 * @param values - The values to include in the preview
 * @returns A string in the form "[item1, item2, …]" containing up to four items; numeric items are formatted and annotated with enum names when `field` provides them. If more than four items exist, the preview ends with ", …".
 */
export function formatEnumArrayPreview(
  field: TelemetryField | undefined,
  values: unknown[]
): string {
  const limit = 4;
  const preview = values.slice(0, limit).map((entry) => {
    if (typeof entry === "number" || typeof entry === "bigint") {
      return formatEnumNumber(field, entry);
    }
    return String(entry);
  });
  const suffix = values.length > limit ? ", …" : "";
  return `[${preview.join(", ")}${suffix}]`;
}