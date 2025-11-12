import React, { useState, useEffect } from "react";
import { EngineState } from "./types";
import { TelemetryWorkload } from "./TelemetryWorkload";
import { urlToId } from "./polling";

export function TelemetryModel({
  state,
  index,
}: {
  state: EngineState;
  index: number; // 👈 add index from parent render loop
}) {
  const { model, workloads } = state;
  const storageKey = `telemetry-expanded-${urlToId(model.instanceURL)}`;
  const updateKey = `telemetry-update-${urlToId(model.instanceURL)}`;

  // ---------------------------------------------------------------------------
  // Initialise expanded state
  // ---------------------------------------------------------------------------
  // 1. If stored preference exists, use that.
  // 2. Otherwise, expand the first four models by default.
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) return saved === "true";
    return index < 4; // 👈 default-open first 4
  });

  // Persist expanded state + polling preference
  useEffect(() => {
    localStorage.setItem(storageKey, String(isExpanded));
    localStorage.setItem(updateKey, String(isExpanded));
  }, [isExpanded, storageKey, updateKey]);

  const handleToggle = () => setIsExpanded((prev) => !prev);

  return (
    <div className="telemetry-model">
      <h3
        onClick={handleToggle}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        {model.modelName}
      </h3>

      <div
        className="telemetry-model-label"
        onClick={handleToggle}
        style={{ cursor: "pointer", userSelect: "none", marginBottom: "4px" }}
      >
        {model.modelPath} | {model.instanceURL}
      </div>

      {isExpanded && (
        <table id={`table-${urlToId(model.instanceURL)}`} className="telemetry">
          <thead>
            <tr>
              <th>Unique Name</th>
              <th>Workload Type</th>
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
      )}
    </div>
  );
}
