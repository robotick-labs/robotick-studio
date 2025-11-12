// src/js/pages/telemetry/TelemetryStructFields.tsx
import React from "react";

function formatNumberSmart(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const intPart = Math.trunc(abs);
  const intDigits = intPart === 0 ? 0 : Math.floor(Math.log10(intPart)) + 1;
  const hasFraction = abs !== intPart;
  const remainingSig = Math.max(0, 4 - intDigits);
  const s =
    remainingSig <= 0
      ? hasFraction
        ? n.toFixed(2)
        : intPart.toString()
      : n.toFixed(remainingSig);
  return s.replace(/\.?0+$/, "");
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

  // Typed arrays / buffers / blobs → concise descriptor
  if (ArrayBuffer.isView(value)) {
    // e.g., Uint8Array, Float32Array
    const ctor = value.constructor?.name ?? "TypedArray";
    return `<${ctor} ${value.byteLength}B>`;
  }
  if (value instanceof ArrayBuffer) {
    return `<ArrayBuffer ${value.byteLength}B>`;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return `<Blob ${value.type || "application/octet-stream"} ${value.size}B>`;
  }
  if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
    return `<ImageBitmap ${value.width}x${value.height}>`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

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
