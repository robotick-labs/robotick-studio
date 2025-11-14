import React, { useState, useEffect } from "react";
import { EngineState } from "./types";
import { TelemetryWorkload } from "./TelemetryWorkload";
import { urlToId } from "../document/polling";

/**
 * Format a byte count with comma thousands separators.
 * Example: 12345678 -> "12,345,678"
 */
export function formatBytesWithCommas(value: any): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  const integerValue = Math.trunc(value);

  const isNegative = integerValue < 0;
  const absValue = Math.abs(integerValue);

  const formatted = absValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return isNegative ? "-" + formatted : formatted;
}

export function TelemetryModel({
  state,
  index,
}: {
  state: EngineState;
  index: number;
}) {
  const { model, workloads, bufferSizeUsed } = state;
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
        {isExpanded && (
          <>
            {" | workloads buffer size: "}
            {formatBytesWithCommas(bufferSizeUsed)} bytes
          </>
        )}
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
