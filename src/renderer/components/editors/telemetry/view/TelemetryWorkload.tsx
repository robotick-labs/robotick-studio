// TelemetryWorkload.tsx
import React from "react";
import { TelemetryStructFields } from "./TelemetryStructFields";
import type { FieldConnectionHint } from "./types";
import styles from "../Telemetry.module.css";
import type { ITelemetryWorkload } from "../../../../data-sources/telemetry";
import { useFloatingPanelsScope } from "../../../workbenches/floating-panels";
import {
  classifyUsagePercent,
  deriveWorkloadStats,
  formatDurationMs,
  formatJitterPercent,
  TICK_DURATION_WINDOW_SIZE,
} from "../utils/workload-stats";
import { formatBytesWithCommas } from "../utils/format-bytes";

interface TelemetryWorkloadProps {
  w: ITelemetryWorkload;
  displayName?: string;
  workloadId?: string;
  telemetryBaseUrl?: string;
  modelId?: string;
  modelName?: string;
  modelPath?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
}

/**
 * Render a table row showing telemetry metrics and metadata for a single workload.
 *
 * Renders workload name and type, config/inputs/outputs as TelemetryStructFields, last tick duration and rolling mean/jitter, last interval and rolling mean/jitter, goal period, and CPU/period usage percentage.
 *
 * @param w - The telemetry workload object containing identification, configuration, I/O structs, and statistics used to compute displayed metrics.
 * @param telemetryBaseUrl - Optional base URL used by TelemetryStructFields for deep links.
 * @param modelName - Optional model name passed to panels and TelemetryStructFields.
 * @returns A JSX table row (<tr>) element that presents the workload's telemetry and derived statistics.
 */
export function TelemetryWorkload({
  w,
  displayName,
  workloadId,
  telemetryBaseUrl,
  modelId,
  modelName,
  modelPath,
  fieldConnectionHints,
}: TelemetryWorkloadProps) {
  const stats = deriveWorkloadStats(w);
  const {
    workloadDuration,
    actualPeriod,
    goalPeriodMs,
    budgetUsagePercent,
  } = stats;
  const workloadJitterPercent = formatJitterPercent(
    workloadDuration.jitterMs,
    goalPeriodMs
  );
  const actualJitterPercent = formatJitterPercent(
    actualPeriod.jitterMs,
    goalPeriodMs
  );

  const usageSeverity = classifyUsagePercent(budgetUsagePercent);
  const usageClassName =
    usageSeverity === "low"
      ? styles.usageBlue
      : usageSeverity === "warning"
      ? styles.usageYellow
      : styles.usageRed;
  const panelScope = useFloatingPanelsScope();
  const hasDynamicMemory = w.workloadsBufferDynamicBytes > 0;
  const resolvedDisplayName = (displayName ?? "").trim() || w.name;
  const resolvedWorkloadId = (workloadId ?? "").trim() || w.name;

  return (
    <tr>
      <td>
        <div className={styles.multiline}>
          <span>{resolvedDisplayName}</span>
          <span className={styles.memoryMeta}>({resolvedWorkloadId})</span>
        </div>
      </td>
      <td>
        <div className={styles.multiline}>
          <span>{w.type}</span>
          <span className={styles.memoryMeta}>
            Memory: {formatBytesWithCommas(w.workloadsBufferTotalBytes)} bytes
            {hasDynamicMemory ? " total" : " (all static)"}
          </span>
          {hasDynamicMemory && (
            <span className={styles.memoryMeta}>
              {formatBytesWithCommas(w.workloadsBufferStaticBytes)} bytes static,{" "}
              {formatBytesWithCommas(w.workloadsBufferDynamicBytes)} bytes dynamic
            </span>
          )}
        </div>
      </td>
      <td>
        <TelemetryStructFields
          struct={w.config}
          telemetryBaseUrl={telemetryBaseUrl}
          workloadId={resolvedWorkloadId}
          workloadName={w.name}
          modelId={modelId}
          modelName={modelName}
          modelPath={modelPath}
          panelScope={panelScope}
          fieldConnectionHints={fieldConnectionHints}
        />
      </td>
      <td>
        <TelemetryStructFields
          struct={w.inputs}
          telemetryBaseUrl={telemetryBaseUrl}
          workloadId={resolvedWorkloadId}
          workloadName={w.name}
          modelId={modelId}
          modelName={modelName}
          modelPath={modelPath}
          panelScope={panelScope}
          fieldConnectionHints={fieldConnectionHints}
        />
      </td>
      <td>
        <TelemetryStructFields
          struct={w.outputs}
          telemetryBaseUrl={telemetryBaseUrl}
          workloadId={resolvedWorkloadId}
          workloadName={w.name}
          modelId={modelId}
          modelName={modelName}
          modelPath={modelPath}
          panelScope={panelScope}
          fieldConnectionHints={fieldConnectionHints}
        />
      </td>
      <td>
        <div className={styles.multiline}>
          <span title="Last tick duration">
            Last: {formatDurationMs(workloadDuration.lastMs)} ms
          </span>
          <span title={`Rolling mean over last ${TICK_DURATION_WINDOW_SIZE} ticks`}>
            Mean: {formatDurationMs(workloadDuration.meanMs)} ms
          </span>
          <span
            title={`Jitter (standard deviation over last ${TICK_DURATION_WINDOW_SIZE} ticks)`}
          >
            Jitter:{" "}
            {workloadJitterPercent
              ? `${workloadJitterPercent} (${formatDurationMs(
                  workloadDuration.jitterMs
                )} ms)`
              : `${formatDurationMs(workloadDuration.jitterMs)} ms`}
          </span>
        </div>
      </td>
      <td>
        <div className={styles.multiline}>
          <span title="Last measured interval between ticks">
            Last: {formatDurationMs(actualPeriod.lastMs)} ms
          </span>
          <span
            title={`Rolling mean over last ${TICK_DURATION_WINDOW_SIZE} tick intervals`}
          >
            Mean: {formatDurationMs(actualPeriod.meanMs)} ms
          </span>
          <span
            title={`Jitter (standard deviation over last ${TICK_DURATION_WINDOW_SIZE} tick intervals)`}
          >
            Jitter:{" "}
            {actualJitterPercent
              ? `${actualJitterPercent} (${formatDurationMs(
                  actualPeriod.jitterMs
                )} ms)`
              : `${formatDurationMs(actualPeriod.jitterMs)} ms`}
          </span>
        </div>
      </td>
      <td>{goalPeriodMs.toFixed(3)}</td>
      <td className={usageClassName}>{budgetUsagePercent.toFixed(1)}%</td>
    </tr>
  );
}
