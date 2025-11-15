// TelemetryWorkload.tsx
import React from "react";
import { TelemetryStructFields } from "./TelemetryStructFields";

function getStat(w: ITelemetryWorkload, fieldName: string) {
  const s = w.stats;
  if (!s) return undefined;
  const f = s.fields.find((f) => f.name === fieldName);
  return f?.getValue();
}

function usageClass(usagePercent: number): string {
  if (usagePercent < 102) return "usage-blue";
  if (usagePercent < 110) return "usage-yellow";
  return "usage-red";
}

export function TelemetryWorkload({ w }) {
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
