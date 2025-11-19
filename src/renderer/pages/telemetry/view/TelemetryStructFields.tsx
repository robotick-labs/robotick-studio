// TelemetryStructFields.tsx
// -----------------------------------------------------------------------------
// Robotick unified structured-field renderer
// Image fields handled with global blob-cache to prevent leaks/churn
// -----------------------------------------------------------------------------
// Robotick Labs 2025
// -----------------------------------------------------------------------------

import React, { useRef, useState } from "react";
import { useBlobURL } from "./telemetry-image-blobs";
import styles from "../Telemetry.module.css";

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

  return <div className={styles.multiline}>{struct.fields.map(renderField)}</div>;
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

  if (!(raw instanceof Uint8Array)) {
    return <div>{label}: &lt;invalid image data&gt;</div>;
  }

  // URL managed by global cache + LRU
  const url = useBlobURL(raw, mime);

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
              const img = e.currentTarget as HTMLImageElement;
              setDims({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onClick={toggle}
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
  const [pos, setPos] = useState({ x: 200, y: 200 });
  const [size, setSize] = useState({ w: 640, h: 420 });
  const panelRef = useRef<HTMLDivElement | null>(null);

  const url = useBlobURL(raw, mime_type);
  const clampPosition = (value: number, min: number, max?: number) => {
    if (typeof max === "number" && Number.isFinite(max)) {
      return Math.min(Math.max(value, min), max);
    }
    return Math.max(value, min);
  };

  function onTitleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...pos };
    const panelEl = panelRef.current;
    const panelWidth = panelEl?.offsetWidth ?? size.w;
    const panelHeight = panelEl?.offsetHeight ?? size.h;
    const maxX = Number.isFinite(panelWidth)
      ? Math.max(0, window.innerWidth - panelWidth)
      : undefined;
    const maxY = Number.isFinite(panelHeight)
      ? Math.max(0, window.innerHeight - panelHeight)
      : undefined;

    function move(ev: MouseEvent) {
      const nextX = clampPosition(orig.x + (ev.clientX - startX), 0, maxX);
      const nextY = clampPosition(orig.y + (ev.clientY - startY), 0, maxY);
      setPos({ x: nextX, y: nextY });
    }

    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...size };

    function move(ev: MouseEvent) {
      setSize({
        w: Math.max(200, orig.w + (ev.clientX - startX)),
        h: Math.max(200, orig.h + (ev.clientY - startY)),
      });
    }

    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      className={styles.imagePanel}
      ref={panelRef}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        display: "block",
      }}
    >
      <div className={styles.imagePanelTitle} onMouseDown={onTitleMouseDown}>
        <span>{path}</span>
        <span className={styles.imagePanelClose} onClick={onClose}>
          ✕
        </span>
      </div>

      {url && (
        <img
          src={url}
          alt={path}
          style={{
            width: "100%",
            height: "calc(100% - 22px)",
            objectFit: "contain",
          }}
        />
      )}

      <div
        className={styles.imagePanelResizeHandle}
        onMouseDown={onResizeMouseDown}
      />
    </div>
  );
}
