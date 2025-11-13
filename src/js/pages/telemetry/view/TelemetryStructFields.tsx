// TelemetryStructFields.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";

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
    return <div className="multiline">–</div>;
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
            setPanels((p) => ({
              ...p,
              [f.path]: !p[f.path],
            }))
          }
          close={() =>
            setPanels((p) => ({
              ...p,
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

  return <div className="multiline">{struct.fields.map(renderField)}</div>;
}

// -------------------------------------------------------------
// ImageField: small wrapper that memoises the URL
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

  // Validate binary
  if (!(raw instanceof Uint8Array)) {
    return <div key={path}>{label}: &lt;invalid image data&gt;</div>;
  }

  // Memoised object URL — new only when raw changes
  const url = useMemo(() => {
    try {
      return URL.createObjectURL(new Blob([raw], { type: mime }));
    } catch {
      return null;
    }
  }, [raw, mime]);

  // Cleanup URL on change/unmount
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <React.Fragment key={path}>
      <div>
        {label}:{" "}
        {url && (
          <img
            src={url}
            alt={label}
            className="telemetry-thumb"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            onClick={toggle}
          />
        )}
      </div>

      {isOpen && (
        <ImagePanel raw={raw} mime_type={mime} path={path} onClose={close} />
      )}
    </React.Fragment>
  );
}

// -------------------------------------------------------------
// ImagePanel — memoised URL, lazy-mounted when opened
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

  // URL created only once per raw
  const url = useMemo(() => {
    try {
      return URL.createObjectURL(new Blob([raw], { type: mime_type }));
    } catch {
      return null;
    }
  }, [raw, mime_type]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  // Dragging
  function onTitleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...pos };

    function move(ev: MouseEvent) {
      setPos({
        x: orig.x + (ev.clientX - startX),
        y: orig.y + (ev.clientY - startY),
      });
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Resizing
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
      className="telemetry-image-panel"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        display: "block",
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

      {url && (
        <img
          src={url}
          alt={path}
          style={{
            width: "100%",
            height: `calc(100% - 22px)`,
            objectFit: "contain",
          }}
        />
      )}

      <div
        className="telemetry-image-panel-resize-handle"
        onMouseDown={onResizeMouseDown}
      />
    </div>
  );
}
