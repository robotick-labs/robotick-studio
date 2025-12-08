// TelemetryStructFields.tsx
// -----------------------------------------------------------------------------
// Robotick unified structured-field renderer
// Image fields handled with global blob-cache to prevent leaks/churn
// -----------------------------------------------------------------------------
// Robotick Labs 2025
// -----------------------------------------------------------------------------

import React, { useState } from "react";
import { useBlobURL } from "./telemetry-image-blobs";
import styles from "../Telemetry.module.css";
import { spawnTelemetryImagePanel } from "../panels";

export interface TelemetryField {
  name: string;
  path: string;
  type: string;
  mime_type?: string;
  fields?: TelemetryField[];
  getValue: () => unknown;
}

export interface TelemetryStruct {
  fields?: TelemetryField[];
}

// -------------------------------------------------------------
// Number formatting
// -------------------------------------------------------------
function formatNumberSmart(n: number): string {
  if (!isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  let decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return n.toFixed(decimals);
}

function formatValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return `<${type}>`;
  if (Array.isArray(value)) return `<${type}, ${value.length}>`;
  if (typeof value === "number") return formatNumberSmart(value);
  if (typeof value === "string") return `"${value}"`;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer)
    return `<${type}> (${value.byteLength} bytes)`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return `<${type}>`;
}

// -------------------------------------------------------------
// Main structured-field renderer
// -------------------------------------------------------------
type StructFieldProps = {
  struct?: TelemetryStruct;
  telemetryBaseUrl?: string;
  workloadName?: string;
  modelName?: string;
  panelScope?: string;
};

export function TelemetryStructFields({
  struct,
  telemetryBaseUrl,
  workloadName,
  modelName,
  panelScope,
}: StructFieldProps) {
  const floatingScope = panelScope ?? "global-floating-panels";

  const fields = struct?.fields;
  if (!fields || fields.length === 0) {
    return <div className={styles.multiline}>–</div>;
  }

  function renderField(f: TelemetryField): React.ReactNode {
    const label = f.name;

    // Nested struct
    if (f.fields && f.fields.length > 0) {
      return (
        <div key={f.path}>
          <b>{label}</b>
          <div key={f.path + "_children"} style={{ marginLeft: 10 }}>
            {f.fields.map((child) => renderField(child))}
          </div>
        </div>
      );
    }

    // Image field
    if (typeof f.mime_type === "string" && f.mime_type.startsWith("image/")) {
      return (
        <ImageField
          key={f.path}
          field={f}
          telemetryBaseUrl={telemetryBaseUrl}
          workloadName={workloadName}
          modelName={modelName}
          panelScope={floatingScope}
        />
      );
    }

    // Primitive leaf
    return (
      <div key={f.path}>
        {label}: {formatValue(f.getValue(), f.type)}
      </div>
    );
  }

  return <div className={styles.multiline}>{fields.map(renderField)}</div>;
}

// -------------------------------------------------------------
// ImageField: thumbnail + dimensions
// -------------------------------------------------------------
function ImageField({
  field,
  telemetryBaseUrl,
  workloadName,
  modelName,
  panelScope,
}: {
  field: TelemetryField;
  telemetryBaseUrl?: string;
  workloadName?: string;
  modelName?: string;
  panelScope: string;
}) {
  const rawValue = field.getValue();
  const path = field.path;
  const label = field.name;
  const mime = field.mime_type;

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  if (!(rawValue instanceof Uint8Array)) {
    return <div>{label}: &lt;invalid image data&gt;</div>;
  }

  // URL managed by global cache + LRU
  const url = useBlobURL(rawValue, mime);
  const handleThumbClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    spawnTelemetryImagePanel({
      scope: panelScope,
      settings: {
        panelTitle: path,
        telemetryBaseUrl,
        workloadName,
        modelName,
        fieldPath: path,
      },
    });
  };

  return (
    <>
      <div>
        {label}:{" "}
        {url && (
          <img
            src={url}
            alt={label}
            className={styles.thumb}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            onLoad={(e) => {
              const target = e.currentTarget as HTMLImageElement | null;
              if (!target) {
                return;
              }
              setDims((prev) => {
                if (prev) {
                  return prev;
                }
                const width = target.naturalWidth;
                const height = target.naturalHeight;
                if (!width || !height) {
                  return prev;
                }
                return { w: width, h: height };
              });
            }}
            onClick={handleThumbClick}
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}
        {dims && ` (${dims.w}×${dims.h})`}
      </div>

      {/* Floating panel handles full image rendering */}
    </>
  );
}
