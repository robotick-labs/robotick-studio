// src/js/pages/telemetry/TelemetryStructFields.tsx
import React, { useMemo } from "react";

function formatNumberSmart(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n === 0) return "0";

  const abs = Math.abs(n);
  const intPart = Math.trunc(abs);
  const intDigits = intPart === 0 ? 0 : Math.floor(Math.log10(intPart)) + 1;
  const hasFraction = abs !== intPart;
  const remainingSig = Math.max(0, 4 - intDigits);

  let formatted: string;

  if (remainingSig <= 0) {
    // Integer part already uses all 4 sig figs
    formatted = hasFraction ? n.toFixed(1) : intPart.toString();
  } else {
    // We have some budget left for fractional digits
    formatted = n.toFixed(remainingSig);
  }

  return formatted.replace(/\.?0+$/, "");
}

export function TelemetryStructFields({ value }: { value: any }) {
  const lines = useMemo(() => {
    if (!value) return ["–"];

    // Support either a single field or an array of fields
    const fields = Array.isArray(value) ? value : Object.values(value);
    const out: string[] = [];

    for (const f of fields) {
      if (f && typeof f.path === "string") {
        const shown =
          f.value === null || f.value === undefined
            ? `<${f.type}>`
            : typeof f.value === "number"
            ? formatNumberSmart(f.value)
            : typeof f.value === "object"
            ? JSON.stringify(f.value)
            : String(f.value);

        out.push(`${f.path}: ${shown}`);
      }
    }

    if (out.length === 0) out.push("–");
    return out;
  }, [value]);

  return (
    <div className="multiline">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
