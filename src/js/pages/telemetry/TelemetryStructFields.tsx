// src/js/pages/telemetry/TelemetryStructFields.tsx
import React from "react";

function formatNumberSmart(n: number): string {
  if (!isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n); // no decimals for ints

  const abs = Math.abs(n);

  // Choose precision tiers for readable, stable output
  let decimals = 2;
  if (abs >= 100) decimals = 1;
  else if (abs >= 10) decimals = 2;
  else decimals = 3;

  return n.toFixed(decimals);
}

function isPlainObject(v: any): v is Record<string, any> {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  // Treat typed arrays, buffers, blobs, dates, images as leaf values
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return false;
  if (typeof Blob !== "undefined" && v instanceof Blob) return false;
  if (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap)
    return false;
  if (v instanceof Date) return false;
  return Object.getPrototypeOf(v) === Object.prototype;
}

function leafToString(value: any): string {
  if (value === null || value === undefined) return "–";
  if (typeof value === "number") return formatNumberSmart(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);

  // Fallback for non-plain objects
  if (!isPlainObject(value)) {
    const name = value?.constructor?.name ?? "Object";
    return `<${name}>`;
  }

  // Plain object fallback
  return JSON.stringify(value);
}

function flattenObject(
  obj: Record<string, any>,
  prefix = "",
  out: { path: string; value: any }[] = []
): { path: string; value: any }[] {
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val)) {
      flattenObject(val, path, out);
    } else {
      out.push({ path, value: val });
    }
  }
  return out;
}

export function TelemetryStructFields({ value }: { value: any }) {
  if (value == null) {
    return <div className="multiline">–</div>;
  }

  const entries = isPlainObject(value)
    ? flattenObject(value)
    : [{ path: "", value }];

  if (entries.length === 0) {
    return <div className="multiline">–</div>;
  }

  return (
    <div className="multiline">
      {entries.map(({ path, value }, i) => (
        <div key={i}>
          {path ? `${path}: ` : ""}
          {leafToString(value)}
        </div>
      ))}
    </div>
  );
}
