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
import type { FieldConnectionHint } from "./types";
import type {
  ITelemetryField as TelemetryField,
  ITelemetryStruct as TelemetryStruct,
} from "../../../../data-sources/telemetry";
import {
  formatEnumArrayPreview,
  formatEnumNumber,
} from "../utils/telemetry-formatters";
import { WritableTelemetryInputField } from "./WritableTelemetryInputField";
import {
  type ConnectionKind,
  getConnectionHint,
  getConnectionKindFromHint,
  getConnectionTooltip,
} from "./field-connections";
import {
  extractTelemetryImagePayload,
  isTelemetryImageField,
} from "../utils/telemetry-image";

const ENABLE_INLINE_IMAGE_PREVIEW = false;

/**
 * Produce a human-readable string representation of a telemetry field's value.
 *
 * Uses the field's metadata (type, enum values) when applicable to choose the display format.
 *
 * @param value - The raw value to format for display.
 * @param field - The telemetry field metadata (type and enum information) used to influence formatting.
 * @returns A display string such as:
 * - `"<type>"` for null/undefined or unknown types,
 * - `"<type, N>"` for arrays (or an enum-aware preview when enum values exist),
 * - a quoted string for string values,
 * - `"<type> (X bytes)"` for binary payloads,
 * - an enum-aware numeric representation for numbers/bigints,
 * - `"true"` or `"false"` for booleans.
 */
function formatValue(value: unknown, field: TelemetryField): string {
  const type = field.type;
  if (value === null || value === undefined) return `<${type}>`;
  if (Array.isArray(value)) {
    if (field.enum_values && field.enum_values.length > 0) {
      return formatEnumArrayPreview(field, value);
    }
    return `<${type}, ${value.length}>`;
  }
  if (typeof value === "number" || typeof value === "bigint")
    return formatEnumNumber(field, value);
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
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
};

function getConnectionCapsuleClass(kind: ConnectionKind | null): string {
  if (kind === "local") return styles.localConnectedCapsule;
  if (kind === "remote") return styles.remoteConnectedCapsule;
  if (kind === "both") return styles.bothConnectedCapsule;
  return "";
}

/**
 * Render a readable view of a telemetry struct's fields, including nested structs and image thumbnails.
 *
 * Renders each field in `struct.fields`: nested structs are displayed with an indented child list, image fields render a thumbnail that can open a floating image panel, and primitive fields show a formatted value.
 *
 * @param struct - Telemetry struct containing the fields to render; if missing or empty a dash is shown.
 * @param telemetryBaseUrl - Optional base URL used when spawning image panels.
 * @param workloadName - Optional workload name used when spawning image panels.
 * @param modelName - Optional model name used when spawning image panels.
 * @param panelScope - Optional scope for floating panels; defaults to `"global-floating-panels"`.
 * @returns A React element containing the rendered fields.
 */
export function TelemetryStructFields({
  struct,
  telemetryBaseUrl,
  workloadName,
  modelName,
  panelScope,
  fieldConnectionHints,
}: StructFieldProps) {
  const floatingScope = panelScope ?? "global-floating-panels";

  const fields = struct?.fields;
  if (!fields || fields.length === 0) {
    return <div className={styles.multiline}>–</div>;
  }

  function renderField(f: TelemetryField): React.ReactNode {
    const label = f.name;
    const connectionHint = getConnectionHint(f.path, fieldConnectionHints);
    const connectionKind = getConnectionKindFromHint(connectionHint);
    const capsuleClass = getConnectionCapsuleClass(connectionKind);
    const tooltipText = getConnectionTooltip(f.path, connectionHint);

    // Image field
    if (isTelemetryImageField(f)) {
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

    // Primitive leaf
    if (typeof f.writable_input_handle === "number") {
      return (
        <WritableTelemetryInputField
          key={f.path}
          field={f}
          telemetryBaseUrl={telemetryBaseUrl}
          capsuleClassName={getConnectionCapsuleClass(connectionKind)}
          tooltipText={tooltipText}
          formatCurrentValue={(field) => formatValue(field.getValue(), field)}
        />
      );
    }

    return (
      <div
        key={f.path}
        className={capsuleClass || undefined}
        title={tooltipText ?? undefined}
      >
        {label}: {formatValue(f.getValue(), f)}
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
  const imagePayload = extractTelemetryImagePayload(field);
  const path = field.path;
  const label = field.name;

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const url = useBlobURL(
    ENABLE_INLINE_IMAGE_PREVIEW ? imagePayload?.bytes ?? null : null,
    ENABLE_INLINE_IMAGE_PREVIEW ? imagePayload?.mime : undefined,
  );

  if (!imagePayload) {
    return <div>{label}: &lt;invalid image data&gt;</div>;
  }

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

  const renderMetadataField = (child: TelemetryField): React.ReactNode => {
    if (child.name === "data_buffer") {
      return null;
    }

    if (child.fields && child.fields.length > 0) {
      return (
        <div key={child.path}>
          <b>{child.name}</b>
          <div style={{ marginLeft: 10 }}>
            {child.fields.map((nested) => renderMetadataField(nested))}
          </div>
        </div>
      );
    }

    return (
      <div key={child.path}>
        {child.name}: {formatValue(child.getValue(), child)}
      </div>
    );
  };

  const metadataFields = (field.fields ?? []).filter(
    (child) => child.name !== "data_buffer",
  );

  return (
    <>
      <div>
        {label}:{" "}
        {ENABLE_INLINE_IMAGE_PREVIEW && url ? (
          <>
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
            {dims && ` (${dims.w}×${dims.h})`}
          </>
        ) : (
          <button
            type="button"
            className={styles.telemetryInlineButton}
            onClick={handleThumbClick}
            onMouseDown={(e) => e.stopPropagation()}
          >
            Open image panel
          </button>
        )}
      </div>
      {metadataFields.length > 0 && (
        <div style={{ marginLeft: 10 }}>
          {metadataFields.map((child) => renderMetadataField(child))}
        </div>
      )}

      {/* Floating panel handles full image rendering */}
    </>
  );
}
