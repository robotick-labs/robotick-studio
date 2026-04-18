import React, { useEffect, useRef, useState } from "react";
import {
  ITelemetryField as TelemetryField,
  useTelemetryService,
} from "../../../../data-sources/telemetry";
import styles from "../Telemetry.module.css";
import { formatNumberSmart } from "../utils/telemetry-formatters";

const INTEGER_FIELD_TYPES = new Set([
  "int",
  "int8_t",
  "int16_t",
  "int32_t",
  "int64_t",
  "uint8_t",
  "uint16_t",
  "uint32_t",
  "uint64_t",
]);

const FLOAT_FIELD_TYPES = new Set(["float", "double"]);
const SCRUB_WRITE_INTERVAL_MS = 80;

function isNumericFieldType(type: string): boolean {
  return INTEGER_FIELD_TYPES.has(type) || FLOAT_FIELD_TYPES.has(type);
}

function isUnsignedIntegerFieldType(type: string): boolean {
  return type.startsWith("uint");
}

function parseDraftValue(field: TelemetryField, draft: string): unknown {
  const trimmed = draft.trim();
  if (field.enum_values && field.enum_values.length > 0) {
    if (trimmed.length === 0) {
      throw new Error("Choose an enum value");
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid enum value");
    }
    return parsed;
  }

  switch (field.type) {
    case "bool": {
      const normal = trimmed.toLowerCase();
      if (normal === "true" || normal === "1") return true;
      if (normal === "false" || normal === "0") return false;
      throw new Error("Boolean must be true/false");
    }
    case "int":
    case "int8_t":
    case "int16_t":
    case "int32_t":
    case "int64_t":
    case "uint8_t":
    case "uint16_t":
    case "uint32_t":
    case "uint64_t": {
      if (trimmed.length === 0) {
        throw new Error("Value required");
      }
      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error("Invalid integer");
      }
      return parsed;
    }
    case "float":
    case "double": {
      if (trimmed.length === 0) {
        throw new Error("Value required");
      }
      const parsed = Number.parseFloat(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new Error("Invalid number");
      }
      return parsed;
    }
    default:
      return draft;
  }
}

function getCurrentFieldDraftValue(field: TelemetryField): string {
  const current = field.getValue();
  if (typeof current === "string") return current;
  if (typeof current === "number" || typeof current === "bigint") {
    if (isNumericFieldType(field.type)) {
      return formatNumberSmart(current);
    }
    return String(current);
  }
  if (typeof current === "boolean") return current ? "true" : "false";
  return "";
}

function getCurrentFieldDraftValueFromValue(
  field: TelemetryField,
  current: unknown
): string {
  if (typeof current === "string") return current;
  if (typeof current === "number" || typeof current === "bigint") {
    if (isNumericFieldType(field.type)) {
      return formatNumberSmart(current);
    }
    return String(current);
  }
  if (typeof current === "boolean") return current ? "true" : "false";
  return "";
}

function formatDraftValueForWrite(field: TelemetryField, value: unknown): string {
  if (typeof value === "number" || typeof value === "bigint") {
    if (isNumericFieldType(field.type)) {
      return formatNumberSmart(value);
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return "";
}

function normalizeNumericValue(field: TelemetryField, value: number): number {
  let next = Number.isFinite(value) ? value : 0;
  if (INTEGER_FIELD_TYPES.has(field.type)) {
    next = Math.round(next);
    if (isUnsignedIntegerFieldType(field.type) && next < 0) {
      next = 0;
    }
    return next;
  }
  return Math.round(next * 1_000_000) / 1_000_000;
}

function parseNumericDraftValue(field: TelemetryField, draftValue: string): number | null {
  try {
    const parsed = parseDraftValue(field, draftValue);
    if (typeof parsed === "number" && Number.isFinite(parsed)) {
      return normalizeNumericValue(field, parsed);
    }
  } catch {
    // Fall back to current field value below.
  }

  const current = field.getValue();
  if (typeof current === "number" && Number.isFinite(current)) {
    return normalizeNumericValue(field, current);
  }
  if (typeof current === "bigint") {
    return normalizeNumericValue(field, Number(current));
  }
  return null;
}

function parseNumericDraftValueFromCurrent(
  field: TelemetryField,
  draftValue: string,
  current: unknown
): number | null {
  try {
    const parsed = parseDraftValue(field, draftValue);
    if (typeof parsed === "number" && Number.isFinite(parsed)) {
      return normalizeNumericValue(field, parsed);
    }
  } catch {
    // Fall back to current field value below.
  }

  if (typeof current === "number" && Number.isFinite(current)) {
    return normalizeNumericValue(field, current);
  }
  if (typeof current === "bigint") {
    return normalizeNumericValue(field, Number(current));
  }
  return null;
}

function getNumericStep(field: TelemetryField, shiftKey: boolean, altKey: boolean): number {
  const baseStep = INTEGER_FIELD_TYPES.has(field.type) ? 1 : 0.01;
  let step = baseStep;
  if (shiftKey) step *= 10;
  if (altKey) step /= 10;
  return step;
}

function defaultFormatCurrentValue(field: TelemetryField): string {
  const value = field.getValue();
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export type WritableTelemetryInputFieldProps = {
  field: TelemetryField;
  telemetryBaseUrl?: string;
  className?: string;
  capsuleClassName?: string;
  tooltipText?: string | null;
  readCurrentValue?: (field: TelemetryField) => unknown;
  formatCurrentValue?: (field: TelemetryField) => string;
};

export function WritableTelemetryInputField({
  field,
  telemetryBaseUrl,
  className,
  capsuleClassName,
  tooltipText,
  readCurrentValue,
  formatCurrentValue = defaultFormatCurrentValue,
}: WritableTelemetryInputFieldProps) {
  const telemetryService = useTelemetryService();
  const readCurrentFieldValue = () =>
    readCurrentValue ? readCurrentValue(field) : field.getValue();
  const [draftValue, setDraftValue] = useState<string>(() =>
    getCurrentFieldDraftValueFromValue(field, readCurrentFieldValue())
  );
  const [optimisticDraftValue, setOptimisticDraftValue] = useState<string | null>(null);
  const [optimisticConnectionEnabled, setOptimisticConnectionEnabled] = useState<boolean | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const scrubRef = useRef<{
    onMove: (event: MouseEvent) => void;
    onUp: () => void;
    startValue: number;
    latestValue: number;
    lastSentValue: number;
    lastSentAtMs: number;
    sendTimerId: number | null;
    previousUserSelect: string;
  } | null>(null);

  const getWritableMeta = () => {
    const liveModel = telemetryBaseUrl
      ? telemetryService.getLatestModel(telemetryBaseUrl)
      : null;
    const writableMeta = liveModel?.writable_inputs_by_path?.get(field.path);
    const targetModel = liveModel ?? field.model;
    const writableHandle = writableMeta?.field_handle ?? field.writable_input_handle;
    const incomingConnectionHandle =
      writableMeta?.incoming_connection_handle ?? field.incoming_connection_handle;
    const incomingConnectionEnabled =
      writableMeta?.incoming_connection_enabled ?? field.incoming_connection_enabled;

    return {
      targetModel,
      writableHandle,
      incomingConnectionHandle,
      incomingConnectionEnabled,
    };
  };

  const setIncomingConnectionEnabled = async (enabled: boolean) => {
    if (!telemetryBaseUrl) {
      return false;
    }

    const writableMeta = getWritableMeta();
    if (
      !writableMeta.targetModel?.schemaSessionId ||
      typeof writableMeta.writableHandle !== "number" ||
      typeof writableMeta.incomingConnectionHandle !== "number"
    ) {
      return false;
    }

    setOptimisticConnectionEnabled(enabled);
    const result = await telemetryService.setWorkloadInputConnectionState(
      telemetryBaseUrl,
      {
        engine_session_id: writableMeta.targetModel.schemaSessionId,
        updates: [
          {
            field_handle: writableMeta.writableHandle,
            field_path: field.path,
            enabled,
          },
        ],
      },
    );
    if (!result.ok) {
      setOptimisticConnectionEnabled(null);
      console.warn("setWorkloadInputConnectionState rejected", {
        fieldPath: field.path,
        status: result.status,
        body: result.body,
      });
      return false;
    }

    return true;
  };

  const submitValue = async (value: unknown) => {
    if (!telemetryBaseUrl) {
      return;
    }

    const writableMeta = getWritableMeta();
    const targetModel = writableMeta.targetModel;
    const writableHandle = writableMeta.writableHandle;
    const connectionEnabled =
      optimisticConnectionEnabled ?? writableMeta.incomingConnectionEnabled;
    if (
      typeof writableMeta.incomingConnectionHandle === "number" &&
      connectionEnabled !== false
    ) {
      const suppressed = await setIncomingConnectionEnabled(false);
      if (!suppressed) {
        return;
      }
    }

    if (!targetModel?.schemaSessionId || typeof writableHandle !== "number") {
      return;
    }

    const optimisticValue = formatDraftValueForWrite(field, value);
    setOptimisticDraftValue(optimisticValue);
    setDraftValue(optimisticValue);

    const result = await telemetryService.setWorkloadInputFieldsData(
      telemetryBaseUrl,
      {
        engine_session_id: targetModel.schemaSessionId,
        writes: [
          {
            field_handle: writableHandle,
            field_path: field.path,
            value,
          },
        ],
      }
    );
    if (!result.ok) {
      setOptimisticDraftValue(null);
      setDraftValue(getCurrentFieldDraftValue(field));
      console.warn("setWorkloadInputFieldsData rejected", {
        fieldPath: field.path,
        status: result.status,
        body: result.body,
      });
    }
  };

  const submitDraft = () => {
    try {
      const parsed = parseDraftValue(field, draftValue);
      void submitValue(parsed);
    } catch (error) {
      if (error instanceof Error) {
        console.warn("Invalid draft for telemetry input", {
          fieldPath: field.path,
          error: error.message,
          draftValue,
        });
      }
      setOptimisticDraftValue(null);
      setDraftValue(currentDraftValue);
    }
  };

  const currentValue = formatCurrentValue(field);
  const currentFieldValue = readCurrentFieldValue();
  const currentDraftValue = getCurrentFieldDraftValueFromValue(
    field,
    currentFieldValue
  );
  const isNumericField = isNumericFieldType(field.type);
  const writableMeta = getWritableMeta();
  const hasIncomingConnection =
    typeof writableMeta.incomingConnectionHandle === "number";
  const reportedIncomingConnectionEnabled = writableMeta.incomingConnectionEnabled;
  const incomingConnectionEnabled =
    optimisticConnectionEnabled ?? reportedIncomingConnectionEnabled;

  useEffect(() => {
    if (isEditing) {
      return;
    }

    if (optimisticDraftValue !== null) {
      if (draftValue !== optimisticDraftValue) {
        setDraftValue(optimisticDraftValue);
      }
      if (currentDraftValue === optimisticDraftValue) {
        setOptimisticDraftValue(null);
      }
      return;
    }

    if (draftValue !== currentDraftValue) {
      setDraftValue(currentDraftValue);
    }
  }, [currentDraftValue, draftValue, isEditing, optimisticDraftValue]);

  useEffect(() => {
    if (!hasIncomingConnection) {
      if (optimisticConnectionEnabled !== null) {
        setOptimisticConnectionEnabled(null);
      }
      return;
    }

    if (
      optimisticConnectionEnabled !== null &&
      reportedIncomingConnectionEnabled === optimisticConnectionEnabled
    ) {
      setOptimisticConnectionEnabled(null);
    }
  }, [
    hasIncomingConnection,
    reportedIncomingConnectionEnabled,
    optimisticConnectionEnabled,
  ]);

  useEffect(() => {
    return () => {
      const scrub = scrubRef.current;
      if (!scrub) return;
      window.removeEventListener("mousemove", scrub.onMove);
      window.removeEventListener("mouseup", scrub.onUp);
      if (scrub.sendTimerId !== null) {
        window.clearTimeout(scrub.sendTimerId);
      }
      document.body.style.userSelect = scrub.previousUserSelect;
      scrubRef.current = null;
    };
  }, []);

  const adjustNumericValue = (
    direction: -1 | 1,
    shiftKey: boolean,
    altKey: boolean
  ) => {
    const currentNumeric = parseNumericDraftValueFromCurrent(
      field,
      draftValue,
      currentFieldValue
    );
    if (currentNumeric === null) {
      return;
    }
    const step = getNumericStep(field, shiftKey, altKey);
    const next = normalizeNumericValue(field, currentNumeric + direction * step);
    setIsEditing(false);
    void submitValue(next);
  };

  const startNumericScrub = (startX: number, startValue: number) => {
    const existing = scrubRef.current;
    if (existing) {
      window.removeEventListener("mousemove", existing.onMove);
      window.removeEventListener("mouseup", existing.onUp);
      if (existing.sendTimerId !== null) {
        window.clearTimeout(existing.sendTimerId);
      }
      document.body.style.userSelect = existing.previousUserSelect;
      scrubRef.current = null;
    }

    setIsEditing(true);
    const pixelsPerStep = 6;
    const scrubState: {
      onMove: (moveEvent: MouseEvent) => void;
      onUp: () => void;
      startValue: number;
      latestValue: number;
      lastSentValue: number;
      lastSentAtMs: number;
      sendTimerId: number | null;
      previousUserSelect: string;
    } = {
      startValue,
      latestValue: startValue,
      lastSentValue: startValue,
      lastSentAtMs: 0,
      sendTimerId: null,
      previousUserSelect: document.body.style.userSelect,
      onMove: () => undefined,
      onUp: () => undefined,
    };
    document.body.style.userSelect = "none";

    const flushScrubValue = (force = false) => {
      if (scrubState.latestValue === scrubState.lastSentValue) {
        return;
      }
      const now = Date.now();
      const elapsed = now - scrubState.lastSentAtMs;
      if (force || elapsed >= SCRUB_WRITE_INTERVAL_MS) {
        scrubState.lastSentAtMs = now;
        scrubState.lastSentValue = scrubState.latestValue;
        void submitValue(scrubState.latestValue);
        return;
      }
      if (scrubState.sendTimerId !== null) {
        return;
      }
      scrubState.sendTimerId = window.setTimeout(() => {
        scrubState.sendTimerId = null;
        flushScrubValue(true);
      }, SCRUB_WRITE_INTERVAL_MS - elapsed);
    };

    scrubState.onMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const deltaPixels = moveEvent.clientX - startX;
      const step = getNumericStep(field, moveEvent.shiftKey, moveEvent.altKey);
      const delta =
        INTEGER_FIELD_TYPES.has(field.type)
          ? Math.trunc(deltaPixels / pixelsPerStep) * step
          : (deltaPixels / pixelsPerStep) * step;
      const next = normalizeNumericValue(field, scrubState.startValue + delta);
      if (next === scrubState.latestValue) {
        return;
      }
      scrubState.latestValue = next;
      setDraftValue(formatNumberSmart(next));
      flushScrubValue(false);
    };

    scrubState.onUp = () => {
      window.removeEventListener("mousemove", scrubState.onMove);
      window.removeEventListener("mouseup", scrubState.onUp);
      if (scrubState.sendTimerId !== null) {
        window.clearTimeout(scrubState.sendTimerId);
        scrubState.sendTimerId = null;
      }
      document.body.style.userSelect = scrubState.previousUserSelect;
      scrubRef.current = null;
      setIsEditing(false);
      flushScrubValue(true);
    };

    scrubRef.current = scrubState;
    window.addEventListener("mousemove", scrubState.onMove);
    window.addEventListener("mouseup", scrubState.onUp);
  };

  const handleNumericScrubHotspotMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (!isNumericField || event.button !== 0) {
      return;
    }

    const startValue = parseNumericDraftValueFromCurrent(
      field,
      draftValue,
      currentFieldValue
    );
    if (startValue === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    startNumericScrub(event.clientX, startValue);
  };

  const rowClassName = [
    styles.inputWriteRow,
    hasIncomingConnection
      ? incomingConnectionEnabled === false
        ? styles.inputWriteRowConnectionSuppressed
        : styles.inputWriteRowConnectionActive
      : "",
    className ?? "",
    capsuleClassName ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const connectionToggle =
    hasIncomingConnection ? (
      <button
        type="button"
        className={`${styles.inputConnectionToggle} ${
          incomingConnectionEnabled === false
            ? styles.inputConnectionToggleSuppressed
            : styles.inputConnectionToggleActive
        }`}
        onClick={() => {
          void setIncomingConnectionEnabled(!(incomingConnectionEnabled === false));
        }}
        title={
          incomingConnectionEnabled === false
            ? "Incoming connection suppressed. Click to re-enable."
            : "Incoming connection active. Click to suppress."
        }
        aria-label={
          incomingConnectionEnabled === false
            ? `Re-enable incoming connection for ${field.name}`
            : `Suppress incoming connection for ${field.name}`
        }
      >
        {"\u26A1"}
      </button>
    ) : null;

  if (field.type === "bool") {
    const checked = (() => {
      const value = currentFieldValue;
      if (typeof value === "boolean") return value;
      const normal = draftValue.toLowerCase();
      return normal === "true" || normal === "1";
    })();

    return (
      <div className={rowClassName} title={tooltipText ?? undefined}>
        <span className={styles.inputWriteLabelText}>{field.name}:</span>
        <span className={styles.inputWriteControls}>
          {connectionToggle}
          <label className={styles.inputWriteCheckboxLabel}>
            <input
              className={styles.inputWriteCheckbox}
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                setDraftValue(event.target.checked ? "true" : "false");
                void submitValue(event.target.checked);
              }}
            />
            <span>{checked ? "true" : "false"}</span>
          </label>
        </span>
      </div>
    );
  }

  if (field.enum_values && field.enum_values.length > 0 && !field.enum_is_flags) {
    return (
      <div className={rowClassName} title={tooltipText ?? undefined}>
        <span className={styles.inputWriteLabelText}>
          {field.name}: {currentValue}
        </span>
        <span className={styles.inputWriteControls}>
          {connectionToggle}
          <span className={styles.inputWriteScrubHotspotSpacer} aria-hidden="true" />
          <select
            className={styles.inputWriteSelect}
            value={draftValue}
            onChange={(event) => {
              const selectedValue = event.target.value;
              setDraftValue(selectedValue);
              setIsEditing(false);
              try {
                const parsed = parseDraftValue(field, selectedValue);
                void submitValue(parsed);
              } catch {
                setDraftValue(currentDraftValue);
              }
            }}
          >
            <option value="">choose enum</option>
            {field.enum_values.map((value) => (
              <option key={`${field.path}-${value.value}`} value={String(value.value)}>
                {value.name} ({value.value})
              </option>
            ))}
          </select>
          <span className={styles.inputWriteStepperSpacer} aria-hidden="true" />
          <span className={styles.inputWriteStepperSpacer} aria-hidden="true" />
        </span>
      </div>
    );
  }

  if (isNumericField) {
    return (
      <div className={rowClassName} title={tooltipText ?? undefined}>
        <span className={styles.inputWriteLabel}>
          <span>{field.name}:</span>
          <span>{currentValue}</span>
        </span>
        <span className={styles.inputWriteControls}>
          {connectionToggle}
          <button
            type="button"
            className={styles.inputWriteScrubHotspot}
            onMouseDown={handleNumericScrubHotspotMouseDown}
            title="Drag horizontally to scrub value (Shift x10, Alt /10)"
            aria-label={`Scrub ${field.name}`}
          >
            <span className={styles.inputWriteScrubDot} />
          </button>
          <input
            className={styles.inputWriteInput}
            type="text"
            inputMode="decimal"
            value={draftValue}
            onFocus={() => setIsEditing(true)}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={() => {
              setIsEditing(false);
              submitDraft();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDraftValue(currentDraftValue);
                setIsEditing(false);
                event.currentTarget.blur();
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                adjustNumericValue(1, event.shiftKey, event.altKey);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                adjustNumericValue(-1, event.shiftKey, event.altKey);
              }
            }}
          />
          <button
            type="button"
            className={styles.inputWriteStepperButton}
            onClick={(event) => adjustNumericValue(-1, event.shiftKey, event.altKey)}
            title="Decrease (Shift x10, Alt /10)"
          >
            -
          </button>
          <button
            type="button"
            className={styles.inputWriteStepperButton}
            onClick={(event) => adjustNumericValue(1, event.shiftKey, event.altKey)}
            title="Increase (Shift x10, Alt /10)"
          >
            +
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className={rowClassName} title={tooltipText ?? undefined}>
      <span className={styles.inputWriteLabelText}>
        {field.name}: {currentValue}
      </span>
      <span className={styles.inputWriteControls}>
        {connectionToggle}
        <span className={styles.inputWriteScrubHotspotSpacer} aria-hidden="true" />
        <input
          className={styles.inputWriteInput}
          type="text"
          value={draftValue}
          onFocus={() => setIsEditing(true)}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={() => {
            setIsEditing(false);
            submitDraft();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraftValue(currentDraftValue);
              setIsEditing(false);
              event.currentTarget.blur();
            }
          }}
        />
        <span className={styles.inputWriteStepperSpacer} aria-hidden="true" />
        <span className={styles.inputWriteStepperSpacer} aria-hidden="true" />
      </span>
    </div>
  );
}
