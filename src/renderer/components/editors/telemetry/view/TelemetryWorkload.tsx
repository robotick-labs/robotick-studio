// TelemetryWorkload.tsx
import React from "react";
import { TelemetryStructFields } from "./TelemetryStructFields";
import styles from "../Telemetry.module.css";
import type { ITelemetryWorkload } from "../../../../data-sources/telemetry";
import { useFloatingPanelsScope } from "../../../workspaces/floating-panels";

const USAGE_THRESHOLD_WARNING_YELLOW = 102;
const USAGE_THRESHOLD_ERROR_RED = 110;
const TICK_DURATION_WINDOW_SIZE = 64;

interface TelemetryWorkloadProps {
  w: ITelemetryWorkload;
  telemetryBaseUrl?: string;
  modelName?: string;
}

function getStat(w: ITelemetryWorkload, fieldName: string): unknown {
  const s = w.stats;
  if (!s || !Array.isArray(s.fields)) return undefined;
  const f = s.fields.find((f) => f.name === fieldName);
  return f?.getValue();
}

function getNumericStat(w: ITelemetryWorkload, fieldName: string): number {
  const value = getStat(w, fieldName);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractWindowSamples(
  w: ITelemetryWorkload,
  fieldName: string
): number[] {
  const windowStruct = getStat(w, fieldName);
  if (!windowStruct || typeof windowStruct !== "object") return [];

  const buffer = (windowStruct as { data_buffer?: unknown }).data_buffer;
  const count = (windowStruct as { count?: unknown }).count;

  if (!Array.isArray(buffer)) return [];

  const maxSamples = buffer.length;
  const usableSamples =
    typeof count === "number" && Number.isFinite(count)
      ? Math.max(0, Math.min(count, maxSamples))
      : maxSamples;

  const samples: number[] = [];
  for (let i = 0; i < usableSamples; i++) {
    const value = buffer[i];
    if (typeof value === "number" && Number.isFinite(value)) {
      samples.push(value);
    }
  }

  return samples;
}

function computeWindowStats(samples: number[]): {
  meanMs?: number;
  jitterMs?: number;
} {
  if (!samples.length) return {};

  const meanNs =
    samples.reduce((acc, value) => acc + value, 0) / samples.length;
  let variance = 0;
  for (const sample of samples) {
    const delta = sample - meanNs;
    variance += delta * delta;
  }
  variance /= samples.length;
  const stdDevNs = Math.sqrt(Math.max(variance, 0));

  return {
    meanMs: meanNs * 1e-6,
    jitterMs: stdDevNs * 1e-6,
  };
}

function formatDuration(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return value.toFixed(3);
}

function formatJitterPercent(
  jitterMs?: number,
  goalPeriodMs?: number
): string | undefined {
  if (
    typeof jitterMs !== "number" ||
    !Number.isFinite(jitterMs) ||
    typeof goalPeriodMs !== "number" ||
    !Number.isFinite(goalPeriodMs) ||
    goalPeriodMs <= 0
  ) {
    return undefined;
  }
  const percent = (100 * jitterMs) / goalPeriodMs;
  return `${percent.toFixed(1)}%`;
}

function usageClass(usagePercent: number): string {
  if (usagePercent < USAGE_THRESHOLD_WARNING_YELLOW) return styles.usageBlue;
  if (usagePercent < USAGE_THRESHOLD_ERROR_RED) return styles.usageYellow;
  return styles.usageRed;
}

export function TelemetryWorkload({
  w,
  telemetryBaseUrl,
  modelName,
}: TelemetryWorkloadProps) {
  const last_ns = getNumericStat(w, "last_tick_duration_ns");
  const dt_ns = getNumericStat(w, "last_time_delta_ns");
  const hz = getNumericStat(w, "tick_rate_hz");

  const self_duration_ms = last_ns * 1e-6;
  const time_delta_ms = dt_ns * 1e-6;
  const goal_period_ms = hz > 0 ? 1000.0 / hz : 0;

  const durationSamples = extractWindowSamples(w, "duration_window");
  const { meanMs, jitterMs } = computeWindowStats(durationSamples);
  const deltaSamples = extractWindowSamples(w, "delta_window");
  const {
    meanMs: actualPeriodMeanMs,
    jitterMs: actualPeriodJitterMs,
  } = computeWindowStats(deltaSamples);
  const workloadJitterPercent = formatJitterPercent(
    jitterMs,
    goal_period_ms
  );
  const actualJitterPercent = formatJitterPercent(
    actualPeriodJitterMs,
    goal_period_ms
  );

  const usage_percent =
    goal_period_ms > 0 ? (100.0 * self_duration_ms) / goal_period_ms : 0;
  const panelScope = useFloatingPanelsScope();

  return (
    <tr>
      <td>{w.name}</td>
      <td>{w.type}</td>
      <td>
        <TelemetryStructFields
          struct={w.config}
          telemetryBaseUrl={telemetryBaseUrl}
          workloadName={w.name}
          modelName={modelName}
          panelScope={panelScope}
        />
      </td>
      <td>
        <TelemetryStructFields
          struct={w.inputs}
          telemetryBaseUrl={telemetryBaseUrl}
          workloadName={w.name}
          modelName={modelName}
          panelScope={panelScope}
        />
      </td>
      <td>
        <TelemetryStructFields
          struct={w.outputs}
          telemetryBaseUrl={telemetryBaseUrl}
          workloadName={w.name}
          modelName={modelName}
          panelScope={panelScope}
        />
      </td>
      <td>
        <div className={styles.multiline}>
          <span title="Last tick duration">
            Last: {formatDuration(self_duration_ms)} ms
          </span>
          <span title={`Rolling mean over last ${TICK_DURATION_WINDOW_SIZE} ticks`}>
            Mean: {formatDuration(meanMs)} ms
          </span>
          <span
            title={`Jitter (standard deviation over last ${TICK_DURATION_WINDOW_SIZE} ticks)`}
          >
            Jitter:{" "}
            {workloadJitterPercent
              ? `${workloadJitterPercent} (${formatDuration(jitterMs)} ms)`
              : `${formatDuration(jitterMs)} ms`}
          </span>
        </div>
      </td>
      <td>
        <div className={styles.multiline}>
          <span title="Last measured interval between ticks">
            Last: {formatDuration(time_delta_ms)} ms
          </span>
          <span
            title={`Rolling mean over last ${TICK_DURATION_WINDOW_SIZE} tick intervals`}
          >
            Mean: {formatDuration(actualPeriodMeanMs)} ms
          </span>
          <span
            title={`Jitter (standard deviation over last ${TICK_DURATION_WINDOW_SIZE} tick intervals)`}
          >
            Jitter:{" "}
            {actualJitterPercent
              ? `${actualJitterPercent} (${formatDuration(
                  actualPeriodJitterMs
                )} ms)`
              : `${formatDuration(actualPeriodJitterMs)} ms`}
          </span>
        </div>
      </td>
      <td>{goal_period_ms.toFixed(3)}</td>
      <td className={usageClass(usage_percent)}>{usage_percent.toFixed(1)}%</td>
    </tr>
  );
}
