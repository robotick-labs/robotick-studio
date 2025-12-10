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

function extractDurationSamples(w: ITelemetryWorkload): number[] {
  const durationWindow = getStat(w, "duration_window");
  if (!durationWindow || typeof durationWindow !== "object") return [];

  const buffer = (durationWindow as { data_buffer?: unknown }).data_buffer;
  const count = (durationWindow as { count?: unknown }).count;

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
  const last_ns = getStat(w, "last_tick_duration_ns") ?? 0;
  const dt_ns = getStat(w, "last_time_delta_ns") ?? 0;
  const hz = getStat(w, "tick_rate_hz") ?? 0;

  const self_duration_ms = last_ns * 1e-6;
  const time_delta_ms = dt_ns * 1e-6;
  const goal_period_ms = hz > 0 ? 1000.0 / hz : 0;

  const windowSamples = extractDurationSamples(w);
  const { meanMs, jitterMs } = computeWindowStats(windowSamples);

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
            Jitter: {formatDuration(jitterMs)} ms
          </span>
        </div>
      </td>
      <td>{time_delta_ms.toFixed(3)}</td>
      <td>{goal_period_ms.toFixed(3)}</td>
      <td className={usageClass(usage_percent)}>{usage_percent.toFixed(1)}%</td>
    </tr>
  );
}
