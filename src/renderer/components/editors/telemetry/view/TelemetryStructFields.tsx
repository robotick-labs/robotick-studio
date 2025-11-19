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
import { GenericPanel } from "../../../dialog/GenericPanel";

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

function formatValue(value: any, type: string): string {
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
export function TelemetryStructFields({ struct }: { struct?: any }) {
  const [panels, setPanels] = useState<Record<string, boolean>>({});

  if (!struct || !struct.fields || struct.fields.length === 0) {
    return <div className={styles.multiline}>–</div>;
  }

  function renderField(f: any): React.ReactNode {
    const label = f.name;

    // Nested struct
    if (f.fields && f.fields.length > 0) {
      return (
        <div key={f.path}>
          <b>{label}</b>
          <div key={f.path + "_children"} style={{ marginLeft: 10 }}>
            {f.fields.map((child: any) => renderField(child))}
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
          isOpen={!!panels[f.path]}
          toggle={() =>
            setPanels((prev) => ({
              ...prev,
              [f.path]: !prev[f.path],
            }))
          }
          close={() =>
            setPanels((prev) => ({
              ...prev,
              [f.path]: false,
            }))
          }
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

  return (
    <div className={styles.multiline}>{struct.fields.map(renderField)}</div>
  );
}

// -------------------------------------------------------------
// ImageField: thumbnail + dimensions
// -------------------------------------------------------------
function ImageField({
  field,
  isOpen,
  toggle,
  close,
}: {
  field: any;
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}) {
  const raw: Uint8Array = field.getValue();
  const path = field.path;
  const label = field.name;
  const mime = field.mime_type;

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const hasDims = Boolean(dims);

  if (!(raw instanceof Uint8Array)) {
    return <div>{label}: &lt;invalid image data&gt;</div>;
  }

  // URL managed by global cache + LRU
  const url = useBlobURL(raw, mime);
  const handleThumbClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    toggle();
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
              if (!hasDims) {
                const img = e.currentTarget as HTMLImageElement;
                setDims({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            onClick={handleThumbClick}
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}
        {dims && ` (${dims.w}×${dims.h})`}
      </div>

      {isOpen && (
        <ImagePanel raw={raw} mime_type={mime} path={path} onClose={close} />
      )}
    </>
  );
}

// -------------------------------------------------------------
// ImagePanel — draggable, resizable large image viewer
// -------------------------------------------------------------
function ImagePanel({
  raw,
  mime_type,
  path,
  onClose,
}: {
  raw: Uint8Array;
  mime_type: string;
  path: string;
  onClose: () => void;
}) {
  const url = useBlobURL(raw, mime_type);
  return (
    <GenericPanel
      title={path}
      onClose={onClose}
      closable
      initialPosition={{ x: 200, y: 200 }}
      initialSize={{ width: 640, height: 420 }}
      minSize={{ width: 320, height: 240 }}
      className={styles.imagePanel}
      headerClassName={styles.imagePanelHeader}
      bodyClassName={styles.imagePanelBody}
      storageKey={`telemetry-image:${path}`}
    >
      {url && <img src={url} alt={path} className={styles.imagePanelImage} />}
    </GenericPanel>
  );
}
