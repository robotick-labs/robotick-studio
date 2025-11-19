// TelemetryWorkload.tsx
import React from "react";
import { TelemetryStructFields } from "./TelemetryStructFields";
import styles from "../Telemetry.module.css";
import type { ITelemetryWorkload } from "../../../../data-sources/telemetry";

const USAGE_THRESHOLD_WARNING_YELLOW = 102;
const USAGE_THRESHOLD_ERROR_RED = 110;

interface TelemetryWorkloadProps {
  w: ITelemetryWorkload;
}

function getStat(w: ITelemetryWorkload, fieldName: string): unknown {
  const s = w.stats;
  if (!s || !Array.isArray(s.fields)) return undefined;
  const f = s.fields.find((f) => f.name === fieldName);
  return f?.getValue();
}

function usageClass(usagePercent: number): string {
  if (usagePercent < USAGE_THRESHOLD_WARNING_YELLOW) return styles.usageBlue;
  if (usagePercent < USAGE_THRESHOLD_ERROR_RED) return styles.usageYellow;
  return styles.usageRed;
}

export function TelemetryWorkload({ w }: TelemetryWorkloadProps) {
  const last_ns = getStat(w, "last_tick_duration_ns") ?? 0;
  const dt_ns = getStat(w, "last_time_delta_ns") ?? 0;
  const hz = getStat(w, "tick_rate_hz") ?? 0;

  const self_duration_ms = last_ns * 1e-6;
  const time_delta_ms = dt_ns * 1e-6;
  const goal_period_ms = hz > 0 ? 1000.0 / hz : 0;

  const usage_percent =
    goal_period_ms > 0 ? (100.0 * self_duration_ms) / goal_period_ms : 0;

  return (
    <tr>
      <td>{w.name}</td>
      <td>{w.type}</td>
      <td>
        <TelemetryStructFields struct={w.config} />
      </td>
      <td>
        <TelemetryStructFields struct={w.inputs} />
      </td>
      <td>
        <TelemetryStructFields struct={w.outputs} />
      </td>
      <td>{self_duration_ms.toFixed(3)}</td>
      <td>{time_delta_ms.toFixed(3)}</td>
      <td>{goal_period_ms.toFixed(3)}</td>
      <td className={usageClass(usage_percent)}>{usage_percent.toFixed(1)}%</td>
    </tr>
  );
}
