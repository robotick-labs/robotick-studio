// TelemetryStructFields.tsx
import React from "react";

// -------------------------------------------------------------
// Number formatting (your original smart formatter, unchanged)
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// Format a leaf value, replacing null with <type>
// -------------------------------------------------------------
function formatValue(value: any, type: string): string {
  if (value === null || value === undefined) {
    return `<${type}>`;
  }

  // ---------------------------------------------------------
  // Arrays → suppress contents, show only type + count
  // ---------------------------------------------------------
  if (Array.isArray(value)) {
    return `<${type}, ${value.length}>`;
  }

  // ---------------------------------------------------------
  // Scalars
  // ---------------------------------------------------------

  // Numbers → stable formatting
  if (typeof value === "number") {
    return formatNumberSmart(value);
  }

  // Strings → quoted
  if (typeof value === "string") {
    return `"${value}"`;
  }

  // Binary blobs → suppressed
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes =
      value instanceof Uint8Array ? value.byteLength : value.byteLength;
    return `<${type}> (${bytes} bytes)`;
  }

  // Bool
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  // Fallback
  return `<${type}>`;
}

// -------------------------------------------------------------
// Main renderer
// -------------------------------------------------------------
export function TelemetryStructFields({ struct }: { struct?: any }) {
  if (!struct || !struct.fields || struct.fields.length === 0) {
    return <div className="multiline">–</div>;
  }

  // Render one field (recursively)
  function renderField(f: any): React.ReactNode {
    const label = f.name; // only the local component (no full path)

    // Composite struct field
    if (f.fields && f.fields.length > 0) {
      return (
        <div key={f.path}>
          <b>{label}</b>
          <div style={{ marginLeft: 10 }}>
            {f.fields.map((child: any) => renderField(child))}
          </div>
        </div>
      );
    }

    // Leaf field
    return (
      <div key={f.path}>
        {label}: {formatValue(f.getValue(), f.type)}
      </div>
    );
  }

  return <div className="multiline">{struct.fields.map(renderField)}</div>;
}
