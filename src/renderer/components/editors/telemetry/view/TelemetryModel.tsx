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
  const MAX_UI_SAMPLE_RATE_HZ = 8;
  const modelStorageId = `${urlToId(model.instanceURL)}-${urlToId(model.modelPath)}`;
  const storageKey = `telemetry-expanded-${urlToId(model.instanceURL)}`;
  const sampleRateOverrideKey = `telemetry-sample-rate-${urlToId(model.instanceURL)}`;
  const workloadSortKeyStorageKey = `telemetry-workload-sort-${modelStorageId}`;
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return saved === "true";
    } catch {
      // Storage may be unavailable (e.g., hardened Electron contexts)
    }
    return index < 4; // default-open first 4 models
  });
  const [sampleRateOverrideText, setPollRateOverrideText] = useState<string>(() => {
    try {
      return localStorage.getItem(sampleRateOverrideKey) ?? "";
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
  const preferredSampleRateHz = model.preferredSampleRateHz;
  const parsedOverrideSampleRateHz = Number(sampleRateOverrideText.trim());
  const effectiveSampleRateHz =
    Number.isFinite(parsedOverrideSampleRateHz) && parsedOverrideSampleRateHz > 0
      ? parsedOverrideSampleRateHz
      : preferredSampleRateHz ?? 20;
  const uiSampleRateHz = Math.max(
    1,
    Math.min(effectiveSampleRateHz, MAX_UI_SAMPLE_RATE_HZ)
  );

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(isExpanded));
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [isExpanded, storageKey]);

  useEffect(() => {
    try {
      const trimmed = sampleRateOverrideText.trim();
      if (trimmed.length === 0) {
        localStorage.removeItem(sampleRateOverrideKey);
      } else {
        localStorage.setItem(sampleRateOverrideKey, trimmed);
      }
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [sampleRateOverrideKey, sampleRateOverrideText]);

  useEffect(() => {
    try {
      localStorage.setItem(workloadSortKeyStorageKey, workloadSortKey);
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [workloadSortKey, workloadSortKeyStorageKey]);

  const { model: telemetryModel, error } = useTelemetryStream(
    model.instanceURL,
    uiSampleRateHz,
    { active: isExpanded, ensureLayout: true }
  );
  const latestModel: ITelemetryModel | null = telemetryModel;

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
  const workloadSignatureMismatch = useMemo(() => {
    const expected = model.expectedWorkloads ?? [];
    const actual = latestModel?.workloads ?? [];
    if (expected.length === 0 || actual.length === 0) return false;

    const expectedPairs = new Set(
      expected.map((workload) => `${workload.name}::${workload.type}`)
    );
    const actualPairs = new Set(
      actual.map((workload) => `${workload.name}::${workload.type}`)
    );

    let matched = 0;
    expectedPairs.forEach((pair) => {
      if (actualPairs.has(pair)) matched += 1;
    });

    const expectedCount = expectedPairs.size;
    if (expectedCount === 0) return false;
    const ratio = matched / expectedCount;
    return matched < Math.min(3, expectedCount) && ratio < 0.5;
  }, [latestModel?.workloads, model.expectedWorkloads]);
  const engineClock = (() => {
    if (!latestModel?.getField) return null;
    const timeNow = Number(latestModel.getField("engine.clock.time_now")?.getValue());
    const timeNowNs = Number(
      latestModel.getField("engine.clock.time_now_ns")?.getValue()
    );
    const tickCount = Number(
      latestModel.getField("engine.clock.tick_count")?.getValue()
    );
    const tickRateHz = Number(
      latestModel.getField("engine.clock.tick_rate_hz")?.getValue()
    );
    const dtSecondsLast = Number(
      latestModel.getField("engine.clock.dt_seconds_last")?.getValue()
    );
    if (
      !Number.isFinite(timeNow) &&
      !Number.isFinite(timeNowNs) &&
      !Number.isFinite(tickCount) &&
      !Number.isFinite(tickRateHz) &&
      !Number.isFinite(dtSecondsLast)
    ) {
      return null;
    }
    return { timeNow, timeNowNs, tickCount, tickRateHz, dtSecondsLast };
  })();
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
                  className={styles.telemetryTableControlSelect}
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
              {" | sample rate (Hz): "}
              <input
                id={`sample-rate-${urlToId(model.instanceURL)}`}
                type="text"
                inputMode="decimal"
                className={styles.sampleRateInput}
                value={sampleRateOverrideText}
                placeholder={
                  preferredSampleRateHz ? String(preferredSampleRateHz) : String(20)
                }
                onChange={(e) => setPollRateOverrideText(e.target.value)}
                onClick={stopInputPropagation}
                onFocus={stopInputPropagation}
              />
              {" "}
              <span className={styles.sampleRateInfo}>
                using {uiSampleRateHz} Hz in UI
                {effectiveSampleRateHz !== uiSampleRateHz
                  ? ` (capped from ${effectiveSampleRateHz} Hz)`
                  : ""}
                {preferredSampleRateHz
                  ? ` (model hint ${preferredSampleRateHz} Hz)`
                  : " (default 20 Hz)"}
              </span>
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div onClick={stopPropagation}>
          {engineClock && (
            <div className={styles.engineStats}>
              engine clock: time_now=
              {Number.isFinite(engineClock.timeNow)
                ? engineClock.timeNow.toFixed(3)
                : "-"}
              s | time_now_ns=
              {Number.isFinite(engineClock.timeNowNs)
                ? Math.trunc(engineClock.timeNowNs).toLocaleString()
                : "-"}
              {" | "}tick_count=
              {Number.isFinite(engineClock.tickCount)
                ? Math.trunc(engineClock.tickCount).toLocaleString()
                : "-"}
              {" | "}tick_rate_hz=
              {Number.isFinite(engineClock.tickRateHz)
                ? engineClock.tickRateHz.toFixed(2)
                : "-"}
              {" | "}dt_seconds_last=
              {Number.isFinite(engineClock.dtSecondsLast)
                ? engineClock.dtSecondsLast.toFixed(6)
                : "-"}
            </div>
          )}
          {error ? (
            <div style={{ color: "#ff6b6b", marginBottom: "0.5rem" }}>
              Failed to load telemetry: {String(error)}
            </div>
          ) : null}
          {workloadSignatureMismatch ? (
            <div style={{ color: "#ffb86b", marginBottom: "0.5rem" }}>
              Telemetry endpoint mismatch: {model.instanceURL} is serving a
              different model than {model.modelName}. Another project/model is
              likely bound to the same telemetry port.
            </div>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}
