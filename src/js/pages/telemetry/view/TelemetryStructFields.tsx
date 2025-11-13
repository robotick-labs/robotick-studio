// TelemetryStructFields.tsx
import React, { useState } from "react";

// Number formatting (unchanged)
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

export function TelemetryStructFields({ struct }: { struct?: any }) {
  const [panels, setPanels] = useState<Record<string, boolean>>({});

  if (!struct || !struct.fields || struct.fields.length === 0) {
    return <div className="multiline">–</div>;
  }

  function renderField(f: any): React.ReactNode {
    const label = f.name;

    if (f.fields && f.fields.length > 0) {
      return (
        <div key={f.path}>
          <b>{label}</b>
          <div style={{ marginLeft: 10 }}>{f.fields.map(renderField)}</div>
        </div>
      );
    }

    if (typeof f.mime_type === "string" && f.mime_type.startsWith("image/")) {
      return renderImageField(f, panels, setPanels);
    }

    return (
      <div key={f.path}>
        {label}: {formatValue(f.getValue(), f.type)}
      </div>
    );
  }

  return <div className="multiline">{struct.fields.map(renderField)}</div>;
}

// -------------------------------------------------------------
// Thumbnail + Live Panel
// -------------------------------------------------------------
function renderImageField(
  f: any,
  panels: Record<string, boolean>,
  setPanels: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
): React.ReactNode {
  const path = f.path;
  const label = f.name;
  const raw = f.getValue();

  if (!(raw instanceof Uint8Array)) {
    return <div key={path}>{label}: &lt;invalid image data&gt;</div>;
  }

  const url = URL.createObjectURL(new Blob([raw], { type: f.mime_type }));

  return (
    <>
      {/* Thumbnail */}
      <div key={path}>
        {label}:{" "}
        <img
          key={raw.byteLength}
          src={url}
          alt={label}
          className="telemetry-thumb"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
          onClick={() =>
            setPanels((p) => ({
              ...p,
              [path]: !p[path],
            }))
          }
          onLoad={() => URL.revokeObjectURL(url)}
        />
      </div>

      {/* Live-updating panel */}
      <ImagePanel
        raw={raw}
        mime_type={f.mime_type}
        path={path}
        visible={!!panels[path]}
        onClose={() =>
          setPanels((p) => ({
            ...p,
            [path]: false,
          }))
        }
      />
    </>
  );
}

// Valid 1x1 black PNG (base64 encoded)
const BLACK_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAA" +
  "AAC0lEQVR42mP8/x8AAwMCAO+Xc0cAAAAASUVORK5CYII=";

function safeCreateImageUrl(raw: Uint8Array, mime_type: string): string {
  try {
    const blob = new Blob([raw], { type: mime_type });
    return URL.createObjectURL(blob);
  } catch {
    return BLACK_PNG_DATA_URL;
  }
}

// -------------------------------------------------------------
// ImagePanel with drag + resize + close
// -------------------------------------------------------------
function ImagePanel({
  raw,
  mime_type,
  path,
  visible,
  onClose,
}: {
  raw: Uint8Array;
  mime_type: string;
  path: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ x: 200, y: 200 });
  const [size, setSize] = useState({ w: 320, h: 320 });

  if (!raw) return null;

  const url = URL.createObjectURL(new Blob([raw], { type: mime_type }));

  // Dragging
  function onTitleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...pos };

    const move = (ev: MouseEvent) => {
      setPos({
        x: orig.x + (ev.clientX - startX),
        y: orig.y + (ev.clientY - startY),
      });
    };

    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Resizing
  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...size };

    const move = (ev: MouseEvent) => {
      setSize({
        w: Math.max(200, orig.w + (ev.clientX - startX)),
        h: Math.max(200, orig.h + (ev.clientY - startY)),
      });
    };

    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      className="telemetry-image-panel"
      style={{
        display: visible ? "block" : "none",
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
      }}
    >
      <div
        className="telemetry-image-panel-title"
        onMouseDown={onTitleMouseDown}
      >
        <span>{path}</span>
        <span className="telemetry-image-panel-close" onClick={onClose}>
          ✕
        </span>
      </div>

      <img
        key={raw.byteLength}
        src={url}
        alt={path}
        style={{
          width: "100%",
          height: `calc(100% - 22px)`,
          objectFit: "contain",
        }}
        onLoad={() => URL.revokeObjectURL(url)}
      />

      <div
        className="telemetry-image-panel-resize-handle"
        onMouseDown={onResizeMouseDown}
      />
    </div>
  );
}
