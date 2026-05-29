import React, { useEffect, useMemo, useState } from "react";
import { EngineModel, FieldConnectionHint } from "./types";
import { TelemetryWorkload } from "./TelemetryWorkload";
import {
  useTelemetryStream,
  ITelemetryModel,
  useTelemetryService,
} from "../../../../data-sources/telemetry";
import { buildUrl } from "../../../../data-sources/launcher/internal/launcher-interface";
import styles from "../Telemetry.module.css";
import { formatBytesWithCommas } from "../utils/format-bytes";

export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  const MAX_UI_SAMPLE_RATE_HZ = 10;
  const modelStorageId = `${urlToId(model.instanceURL)}-${urlToId(model.modelPath)}`;
  const storageKey = `telemetry-expanded-${urlToId(model.instanceURL)}`;
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
  const telemetryPushRateHz = model.telemetryPushRateHz;
  const effectiveSampleRateHz = telemetryPushRateHz ?? 20;
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
  const telemetryService = useTelemetryService();
  const latestModel: ITelemetryModel | null = telemetryModel;
  const [studioIngressRateHz, setStudioIngressRateHz] = useState(0);
  const [pushStats, setPushStats] = useState<{
    configuredPushRateHz: number;
    goalPushRateHz: number;
    sourceTickRateHz: number;
    pushEveryNTicks: number;
    actualPushRateHz: number;
    lastPushDurationMs: number;
    lastPushPeriodMs: number;
    lastPushCostPctOfPeriod: number;
  } | null>(null);

  useEffect(() => {
    if (!isExpanded) {
      setPushStats(null);
      setStudioIngressRateHz(0);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const update = async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      setStudioIngressRateHz(
        telemetryService.getIngressRateHz(model.instanceURL, 4000)
      );
      try {
        const response = await fetch(
          buildUrl(model.instanceURL, "/api/telemetry/push_stats"),
          {
            cache: "no-store",
          }
        );
        if (!response.ok || cancelled) {
          return;
        }
        const payload = (await response.json()) as {
          configured_push_rate_hz?: number;
          goal_push_rate_hz?: number;
          source_tick_rate_hz?: number;
          push_every_n_ticks?: number;
          actual_push_rate_hz?: number;
          last_push_duration_ms?: number;
          last_push_period_ms?: number;
          last_push_cost_pct_of_period?: number;
        };
        if (cancelled) {
          return;
        }
        setPushStats({
          configuredPushRateHz: Number(payload.configured_push_rate_hz ?? telemetryPushRateHz ?? 20),
          goalPushRateHz: Number(payload.goal_push_rate_hz ?? 0),
          sourceTickRateHz: Number(payload.source_tick_rate_hz ?? 0),
          pushEveryNTicks: Number(payload.push_every_n_ticks ?? 1),
          actualPushRateHz: Number(payload.actual_push_rate_hz ?? 0),
          lastPushDurationMs: Number(payload.last_push_duration_ms ?? 0),
          lastPushPeriodMs: Number(payload.last_push_period_ms ?? 0),
          lastPushCostPctOfPeriod: Number(payload.last_push_cost_pct_of_period ?? 0),
        });
      } catch {
        // Keep telemetry UI resilient if push stats endpoint is unavailable.
      } finally {
        inFlight = false;
      }
    };
    void update();
    const timerId = window.setInterval(() => {
      void update();
    }, 400);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [isExpanded, model.instanceURL, telemetryService]);

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

    const expectedPairs = new Set<string>();
    expected.forEach((workload) => {
      const type = workload.type?.trim();
      if (!type) {
        return;
      }
      const id = workload.id?.trim();
      const name = workload.name?.trim();
      if (id) {
        expectedPairs.add(`${id}::${type}`);
      }
      if (name) {
        expectedPairs.add(`${name}::${type}`);
      }
    });
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
    const timeNow = toFiniteNumber(
      latestModel.getField("engine.clock.time_now")?.getValue()
    );
    const timeNowNs = toFiniteNumber(
      latestModel.getField("engine.clock.time_now_ns")?.getValue()
    );
    const tickCount = toFiniteNumber(
      latestModel.getField("engine.clock.tick_count")?.getValue()
    );
    const tickRateHz = toFiniteNumber(
      latestModel.getField("engine.clock.tick_rate_hz")?.getValue()
    );
    const dtSecondsLast = toFiniteNumber(
      latestModel.getField("engine.clock.dt_seconds_last")?.getValue()
    );
    if (timeNow === null && timeNowNs === null && tickCount === null && tickRateHz === null && dtSecondsLast === null) {
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
  const workloadDisplayMetaByRuntimeName = useMemo(() => {
    const map = new Map<string, { displayName: string; workloadId: string }>();
    for (const expectedWorkload of model.expectedWorkloads ?? []) {
      const id = expectedWorkload.id?.trim() ?? "";
      const name = expectedWorkload.name?.trim() ?? "";
      if (id) {
        map.set(id, {
          displayName: name || id,
          workloadId: id,
        });
      } else if (name) {
        map.set(name, {
          displayName: name,
          workloadId: name,
        });
      }
    }
    return map;
  }, [model.expectedWorkloads]);

  const handleToggle = () => setIsExpanded((prev) => !prev);
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();
  const stopInputPropagation = (e: React.SyntheticEvent) => e.stopPropagation();
  const engineClockText = engineClock
    ? `Engine Clock: time_now=${engineClock.timeNow !== null ? engineClock.timeNow.toFixed(3) : "0.000"}s | tick_rate_hz=${engineClock.tickRateHz !== null ? engineClock.tickRateHz.toFixed(2) : "0.00"} | dt_seconds_last=${engineClock.dtSecondsLast !== null ? engineClock.dtSecondsLast.toFixed(6) : "0.000000"}`
    : null;
  const enginePushText = `Engine Telemetry: configured ${
    pushStats ? pushStats.configuredPushRateHz.toFixed(1) : (telemetryPushRateHz || 20).toFixed(1)
  } Hz | quantized ${
    pushStats ? pushStats.goalPushRateHz.toFixed(1) : (telemetryPushRateHz || 20).toFixed(1)
  } Hz${
    pushStats && pushStats.sourceTickRateHz > 0
      ? ` (${pushStats.pushEveryNTicks.toFixed(0)} ticks @ ${pushStats.sourceTickRateHz.toFixed(1)}Hz)`
      : ""
  } | actual ${
    pushStats ? pushStats.actualPushRateHz.toFixed(1) : "0.0"
  } Hz | tx duty ${
    pushStats ? `${pushStats.lastPushCostPctOfPeriod.toFixed(1)}%` : "0.0%"
  }${
    pushStats
      ? ` (send ${pushStats.lastPushDurationMs.toFixed(1)}ms / period ${pushStats.lastPushPeriodMs.toFixed(1)}ms)`
      : ""
  }`;
  const studioPushText = `Studio Telemetry: ingress ${studioIngressRateHz.toFixed(1)} Hz | requested (this panel) ${uiSampleRateHz.toFixed(1)} Hz`;

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
              {" | telemetry push stats below"}
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div onClick={stopPropagation}>
          <div className={styles.telemetryStatsStack}>
            {engineClockText && (
              <div className={`${styles.engineStats} ${styles.telemetryStatsCapsule}`}>
                {engineClockText}
              </div>
            )}
            <div className={styles.telemetryStatsFlowRow}>
              <div className={`${styles.engineStats} ${styles.telemetryStatsCapsule}`}>
                {enginePushText}
              </div>
              <span className={styles.telemetryStatsArrow} aria-hidden="true">
                <span className={styles.telemetryStatsArrowShaft} />
                <span className={styles.telemetryStatsArrowHead} />
              </span>
              <div className={`${styles.engineStats} ${styles.telemetryStatsCapsule}`}>
                {studioPushText}
              </div>
            </div>
          </div>
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
            <div className={styles.tableViewport}>
              <table
                id={`table-${urlToId(model.instanceURL)}`}
                className={styles.table}
              >
                <colgroup>
                  <col className={styles.colUniqueName} />
                  <col className={styles.colWorkloadType} />
                  <col className={styles.colStruct} />
                  <col className={styles.colStruct} />
                  <col className={styles.colStruct} />
                  <col className={styles.colMetric} />
                  <col className={styles.colMetric} />
                  <col className={styles.colGoal} />
                  <col className={styles.colBudget} />
                </colgroup>
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
                  {workloads.map((w) => {
                    const meta = workloadDisplayMetaByRuntimeName.get(w.name);
                    return (
                    <TelemetryWorkload
                      key={w.name}
                      w={w}
                      displayName={meta?.displayName}
                      workloadId={meta?.workloadId}
                      telemetryBaseUrl={model.instanceURL}
                      modelId={model.modelId}
                      modelName={model.modelName}
                      modelPath={model.modelPath}
                      fieldConnectionHints={fieldConnectionHints}
                    />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
