import type {
  ITelemetryField as TelemetryField,
} from "../../../../data-sources/telemetry";

type NumericValue = number | bigint;

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
