// src/js/pages/telemetry/TelemetryWorkload.tsx
import React from "react";
import { Workload } from "./types";
import { TelemetryStructFields } from "./TelemetryStructFields";

export function TelemetryWorkload({ w }: { w: Workload }) {
  const rawSelf = typeof w.self_ms === "number" ? w.self_ms : null;
  const rawGoal = typeof w.goal_ms === "number" ? w.goal_ms : null;

  const self_ms = rawSelf !== null ? rawSelf.toFixed(1) : "–";
  const dt_ms = typeof w.dt_ms === "number" ? w.dt_ms.toFixed(1) : "–";
  const goal_ms = rawGoal !== null ? rawGoal.toFixed(1) : "–";
  const load_pct =
    rawSelf !== null && rawGoal && rawGoal > 0
      ? ((rawSelf / rawGoal) * 100).toFixed(1)
      : "–";

  let usageClass = "";
  if (rawSelf !== null && rawGoal && rawGoal > 0) {
    const pct = (rawSelf / rawGoal) * 100;
    if (pct < 105) usageClass = "usage-blue";
    else if (pct <= 110) usageClass = "usage-yellow";
    else usageClass = "usage-red";
  }

  return (
    <tr>
      <td>{w.name}</td>
      <td>{(w.type || "–").replace("Workload", "")}</td>
      <td>
        <TelemetryStructFields value={w.config} />
      </td>
      <td>
        <TelemetryStructFields value={w.inputs} />
      </td>
      <td>
        <TelemetryStructFields value={w.outputs} />
      </td>
      <td>{self_ms}</td>
      <td>{dt_ms}</td>
      <td>{goal_ms}</td>
      <td className={`usage ${usageClass}`}>{load_pct}</td>
    </tr>
  );
}
