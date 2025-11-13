// TelemetryWorkload.tsx
import React from "react";
import { TelemetryStructFields } from "./TelemetryStructFields";

export function TelemetryWorkload({ w }) {
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
    </tr>
  );
}
