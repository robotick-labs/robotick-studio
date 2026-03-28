import React, { useEffect, useMemo, useState } from "react";
import { EngineModel, FieldConnectionHint } from "./types";
import { TelemetryWorkload } from "./TelemetryWorkload";
import {
  useTelemetryStream,
  ITelemetryModel,
} from "../../../../data-sources/telemetry";
import styles from "../Telemetry.module.css";

export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}

/**
 * Format a byte count with comma thousands separators.
 * Example: 12345678 -> "12,345,678"
 */
export function formatBytesWithCommas(
  value: number | null | undefined
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  const integerValue = Math.trunc(value);

  const isNegative = integerValue < 0;
  const absValue = Math.abs(integerValue);

  const formatted = absValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return isNegative ? "-" + formatted : formatted;
}

/**
 * Renders a collapsible telemetry view for a single engine model.
 *
 * When expanded, subscribes to the model's telemetry stream, displays process and workloads
 * memory usage, and renders a table of workload telemetry. Expansion state is persisted
 * to localStorage (when available) and defaults to open for the first four models.
 *
 * @param model - The engine model to display telemetry for.
 * @param index - The zero-based index of this model in the list; used to determine the default expanded state.
 * @returns The rendered telemetry UI for the provided model.
 */
export function TelemetryModel({
  model,
  index,
}: {
  model: EngineModel;
  index: number;
}) {
  const storageKey = `telemetry-expanded-${urlToId(model.instanceURL)}`;
  const pollRateOverrideKey = `telemetry-poll-rate-${urlToId(model.instanceURL)}`;
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return saved === "true";
    } catch {
      // Storage may be unavailable (e.g., hardened Electron contexts)
    }
    return index < 4; // default-open first 4 models
  });
  const [pollRateOverrideText, setPollRateOverrideText] = useState<string>(() => {
    try {
      return localStorage.getItem(pollRateOverrideKey) ?? "";
    } catch {
      return "";
    }
  });
  const preferredPollRateHz = model.preferredPollRateHz;
  const parsedOverridePollRateHz = Number(pollRateOverrideText.trim());
  const effectivePollRateHz =
    Number.isFinite(parsedOverridePollRateHz) && parsedOverridePollRateHz > 0
      ? parsedOverridePollRateHz
      : preferredPollRateHz ?? 20;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(isExpanded));
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [isExpanded, storageKey]);

  useEffect(() => {
    try {
      const trimmed = pollRateOverrideText.trim();
      if (trimmed.length === 0) {
        localStorage.removeItem(pollRateOverrideKey);
      } else {
        localStorage.setItem(pollRateOverrideKey, trimmed);
      }
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [pollRateOverrideKey, pollRateOverrideText]);

  const { model: telemetryModel, error } = useTelemetryStream(
    isExpanded ? model.instanceURL : "",
    effectivePollRateHz
  );
  const [latestModel, setLatestModel] = useState<ITelemetryModel | null>(null);

  useEffect(() => {
    if (telemetryModel) {
      setLatestModel(telemetryModel);
    }
  }, [telemetryModel]);

  const workloads = latestModel?.workloads ?? [];
  const workloadsMemoryUsed = latestModel?.workloads_buffer_size_used ?? 0;
  const processMemoryUsed = latestModel?.process_memory_used ?? 0;
  const fieldConnectionHints = useMemo(
    () =>
      new Map<string, FieldConnectionHint>(
        Object.entries(model.fieldConnectionHints ?? {})
      ),
    [model.fieldConnectionHints]
  );

  const handleToggle = () => setIsExpanded((prev) => !prev);
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();
  const stopInputPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className={styles.model}>
      <div
        onClick={handleToggle}
        style={{ cursor: "pointer", marginBottom: isExpanded ? "0.5rem" : 0 }}
      >
        <h3 style={{ margin: 0 }}>{model.modelName}</h3>

        <div className={styles.modelLabel} style={{ marginBottom: "4px" }}>
          {model.modelPath} | {model.instanceURL}
          {isExpanded && (
            <>
              {" | process memory: "}
              {formatBytesWithCommas(processMemoryUsed)} bytes
              {" | workloads memory: "}
              {formatBytesWithCommas(workloadsMemoryUsed)} bytes
              {" | poll rate (Hz): "}
              <input
                id={`poll-rate-${urlToId(model.instanceURL)}`}
                type="text"
                inputMode="decimal"
                className={styles.pollRateInput}
                value={pollRateOverrideText}
                placeholder={
                  preferredPollRateHz ? String(preferredPollRateHz) : String(20)
                }
                onChange={(e) => setPollRateOverrideText(e.target.value)}
                onClick={stopInputPropagation}
                onFocus={stopInputPropagation}
              />
              {" "}
              <span className={styles.pollRateInfo}>
                using {effectivePollRateHz} Hz
                {preferredPollRateHz
                  ? ` (model hint ${preferredPollRateHz} Hz)`
                  : " (default 20 Hz)"}
              </span>
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div onClick={stopPropagation}>
          {error ? (
            <div style={{ color: "#ff6b6b", marginBottom: "0.5rem" }}>
              Failed to load telemetry: {String(error)}
            </div>
          ) : null}
          <table
            id={`table-${urlToId(model.instanceURL)}`}
            className={styles.table}
          >
            <thead>
              <tr>
                <th>Unique Name</th>
                <th>Workload Type</th>
                <th>Config</th>
                <th>Inputs</th>
                <th>Outputs</th>
                <th>Workload Duration (ms)</th>
                <th>Actual Period (ms)</th>
                <th>Goal Period (ms)</th>
                <th>Budget Usage %</th>
              </tr>
            </thead>
            <tbody>
              {workloads.map((w) => (
                <TelemetryWorkload
                  key={w.name}
                  w={w}
                  telemetryBaseUrl={model.instanceURL}
                  modelName={model.modelName}
                  fieldConnectionHints={fieldConnectionHints}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
