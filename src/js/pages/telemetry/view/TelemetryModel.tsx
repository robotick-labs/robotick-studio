import React, { useState, useEffect } from "react";
import { EngineState } from "./types";
import { TelemetryWorkload } from "./TelemetryWorkload";
import { urlToId } from "../document/polling";

export function TelemetryModel({
  state,
  index,
}: {
  state: EngineState;
  index: number;
}) {
  const { model, workloads } = state;
  const storageKey = `telemetry-expanded-${urlToId(model.instanceURL)}`;
  const updateKey = `telemetry-update-${urlToId(model.instanceURL)}`;

  // Initialise expanded state (persisted in localStorage)
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) return saved === "true";
    return index < 4; // default-open first 4 models
  });

  // Persist expanded state + polling preference
  useEffect(() => {
    localStorage.setItem(storageKey, String(isExpanded));
    localStorage.setItem(updateKey, String(isExpanded));
  }, [isExpanded, storageKey, updateKey]);

  const handleToggle = () => setIsExpanded((prev) => !prev);

  // Prevent clicks inside the table from toggling expansion
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="telemetry-model" onClick={handleToggle}>
      <h3 style={{ margin: 0 }}>{model.modelName}</h3>

      <div className="telemetry-model-label" style={{ marginBottom: "4px" }}>
        {model.modelPath} | {model.instanceURL}
      </div>

      {isExpanded && (
        <div onClick={stopPropagation}>
          <table
            id={`table-${urlToId(model.instanceURL)}`}
            className="telemetry"
          >
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
        </div>
      )}
    </div>
  );
}
