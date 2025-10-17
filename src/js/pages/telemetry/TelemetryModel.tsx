// src/js/pages/telemetry/TelemetryModel.tsx
import React from "react";
import { EngineState } from "./types";
import { TelemetryWorkload } from "./TelemetryWorkload";
import { urlToId } from "./polling";

export function TelemetryModel({ state }: { state: EngineState }) {
  const { model, workloads } = state;

  return (
    <div className="telemetry-model">
      <h3>{model.modelName}</h3>
      <div className="telemetry-model-label">
        {model.modelPath} | {model.instanceURL}
      </div>

      <table id={`table-${urlToId(model.instanceURL)}`} className="telemetry">
        <thead>
          <tr>
            <th>Unique Name</th>
            <th>TelemetryWorkload Type</th>
            <th>Config</th>
            <th>Inputs</th>
            <th>Outputs</th>
            <th>Self Duration (ms)</th>
            <th>Time Delta (ms)</th>
            <th>Goal Period (ms)</th>
            <th>Usage %</th>
          </tr>
        </thead>
        <tbody>
          {workloads.map((w) => (
            <TelemetryWorkload key={w.name} w={w} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
