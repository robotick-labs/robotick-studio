import React, { useEffect, useMemo, useState } from "react";
import { EngineModel, FieldConnectionHint } from "./types";
import { TelemetryWorkload } from "./TelemetryWorkload";
import {
  useTelemetryStream,
  ITelemetryModel,
} from "../../../../data-sources/telemetry";
import styles from "../Telemetry.module.css";
import { formatBytesWithCommas } from "../utils/format-bytes";

export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}

type WorkloadSortKey =
  | "none"
  | "unique_name"
  | "workload_type"
  | "memory_total"
  | "memory_static"
  | "memory_dynamic";

const WORKLOAD_SORT_OPTIONS: ReadonlyArray<{
  value: WorkloadSortKey;
  label: string;
}> = [
  { value: "none", label: "-" },
  { value: "unique_name", label: "Unique Name" },
  { value: "workload_type", label: "Workload Type" },
  { value: "memory_total", label: "Memory - Total" },
  { value: "memory_static", label: "Memory - Static" },
  { value: "memory_dynamic", label: "Memory - Dynamic" },
];

function compareWorkloads(
  left: NonNullable<ITelemetryModel["workloads"]>[number],
  right: NonNullable<ITelemetryModel["workloads"]>[number],
  sortKey: WorkloadSortKey,
): number {
  switch (sortKey) {
    case "workload_type": {
      const byType = left.type.localeCompare(right.type);
      return byType !== 0 ? byType : left.name.localeCompare(right.name);
    }
    case "memory_total": {
      const byTotal =
        right.workloadsBufferTotalBytes - left.workloadsBufferTotalBytes;
      return byTotal !== 0 ? byTotal : left.name.localeCompare(right.name);
    }
    case "memory_static": {
      const byStatic =
        right.workloadsBufferStaticBytes - left.workloadsBufferStaticBytes;
      return byStatic !== 0 ? byStatic : left.name.localeCompare(right.name);
    }
    case "memory_dynamic": {
      const byDynamic =
        right.workloadsBufferDynamicBytes - left.workloadsBufferDynamicBytes;
      return byDynamic !== 0 ? byDynamic : left.name.localeCompare(right.name);
    }
    case "none":
    case "unique_name":
    default:
      return left.name.localeCompare(right.name);
  }
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
  const workloadSortKeyStorageKey = `telemetry-workload-sort-${urlToId(model.instanceURL)}`;
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
  const [workloadSortKey, setWorkloadSortKey] = useState<WorkloadSortKey>(() => {
    try {
      const saved = localStorage.getItem(workloadSortKeyStorageKey);
      if (
        saved === "none" ||
        saved === "unique_name" ||
        saved === "workload_type" ||
        saved === "memory_total" ||
        saved === "memory_static" ||
        saved === "memory_dynamic"
      ) {
        return saved;
      }
    } catch {
      // Storage may be unavailable (e.g., hardened Electron contexts)
    }
    return "none";
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

  useEffect(() => {
    try {
      localStorage.setItem(workloadSortKeyStorageKey, workloadSortKey);
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [workloadSortKey, workloadSortKeyStorageKey]);

  const { model: telemetryModel, error } = useTelemetryStream(
    model.instanceURL,
    effectivePollRateHz,
    { active: isExpanded, ensureLayout: true }
  );
  const [latestModel, setLatestModel] = useState<ITelemetryModel | null>(null);

  useEffect(() => {
    if (telemetryModel) {
      setLatestModel(telemetryModel);
    }
  }, [telemetryModel]);

  const workloads = useMemo(() => {
    const unsorted = latestModel?.workloads ?? [];
    if (workloadSortKey === "none") {
      return unsorted;
    }
    return [...unsorted].sort((left, right) =>
      compareWorkloads(left, right, workloadSortKey),
    );
  }, [latestModel?.workloads, workloadSortKey]);
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
        <div className={styles.modelHeaderRow}>
          <h3 style={{ margin: 0 }}>{model.modelName}</h3>
          {isExpanded && (
            <div className={styles.modelHeaderControl}>
              <label className={styles.telemetryTableControlLabel}>
                Sort workloads by:
                <select
                  id={`workload-sort-${urlToId(model.instanceURL)}`}
                  className={`${styles.telemetryTableControlSelect} ${
                    workloadSortKey === "none"
                      ? styles.telemetryTableControlSelectOff
                      : ""
                  }`}
                  value={workloadSortKey}
                  onChange={(e) =>
                    setWorkloadSortKey(e.target.value as WorkloadSortKey)
                  }
                  onClick={stopInputPropagation}
                  onFocus={stopInputPropagation}
                >
                  {WORKLOAD_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        <div className={styles.modelLabel} style={{ marginBottom: "4px" }}>
          {model.modelPath} | {model.instanceURL}
          {latestModel && (
            <>
              {" | process memory: "}
              {formatBytesWithCommas(processMemoryUsed)} bytes
              {" | workloads memory: "}
              {formatBytesWithCommas(workloadsMemoryUsed)} bytes
            </>
          )}
          {isExpanded && (
            <>
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
