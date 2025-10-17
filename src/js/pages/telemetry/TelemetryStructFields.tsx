// src/js/pages/telemetry/TelemetryStructFields.tsx
import React, { useMemo } from "react";

export function TelemetryStructFields({ value }: { value: any }) {
  const lines = useMemo(() => {
    if (!value || typeof value !== "object") return ["–"];

    const out: string[] = [];
    const seen = new WeakSet<object>();

    const walk = (val: any, path: string) => {
      if (val === null) {
        out.push(`${path}: null`);
        return;
      }
      const t = typeof val;
      if (t === "object") {
        if (seen.has(val)) {
          out.push(`${path}: [Circular]`);
          return;
        }
        seen.add(val);

        if (Array.isArray(val)) {
          if (val.length === 0) out.push(`${path}: []`);
          else val.forEach((item, i) => walk(item, `${path}[${i}]`));
        } else {
          const keys = Object.keys(val);
          if (keys.length === 0) out.push(`${path}: {}`);
          else keys.forEach((k) => walk(val[k], path ? `${path}.${k}` : k));
        }
      } else {
        out.push(`${path}: ${String(val)}`);
      }
    };

    Object.keys(value).forEach((k) => walk(value[k], k));
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
