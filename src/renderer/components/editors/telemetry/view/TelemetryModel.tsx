import React, { useEffect, useState } from "react";
import { EngineModel } from "./types";
import { TelemetryWorkload } from "./TelemetryWorkload";
import {
  useTelemetryStream,
  ITelemetryModel,
} from "../../../../data-sources/telemetry";
import styles from "../Telemetry.module.css";

export function urlToId(url: string) {
  return url.replace(/[:/.]/g, "_");
}

/**
 * Format a byte count with comma thousands separators.
 * Example: 12345678 -> "12,345,678"
 */
export function formatBytesWithCommas(
  value: number | null | undefined
): string {
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
  model,
  index,
}: {
  model: EngineModel;
  index: number;
}) {
  const storageKey = `telemetry-expanded-${urlToId(model.instanceURL)}`;
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return saved === "true";
    } catch {
      // Storage may be unavailable (e.g., hardened Electron contexts)
    }
    return index < 4; // default-open first 4 models
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(isExpanded));
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [isExpanded, storageKey]);

  const { model: telemetryModel, error } = useTelemetryStream(
    isExpanded ? model.instanceURL : "",
    20
  );
  const [latestModel, setLatestModel] = useState<ITelemetryModel | null>(null);

  useEffect(() => {
    if (telemetryModel) {
      setLatestModel(telemetryModel);
    }
  }, [telemetryModel]);

  const workloads = latestModel?.workloads ?? [];
  const workloadsMemoryUsed = latestModel?.workloads_buffer_size_used ?? 0;
  const processMemoryUsed = latestModel?.process_memory_used ?? 0;

  const handleToggle = () => setIsExpanded((prev) => !prev);
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={styles.model} onClick={handleToggle}>
      <h3 style={{ margin: 0 }}>{model.modelName}</h3>

      <div className={styles.modelLabel} style={{ marginBottom: "4px" }}>
        {model.modelPath} | {model.instanceURL}
        {isExpanded && (
          <>
            {" | process memory: "}
            {formatBytesWithCommas(processMemoryUsed)} bytes
            {" | workloads memory: "}
            {formatBytesWithCommas(workloadsMemoryUsed)} bytes
          </>
        )}
      </div>

      {isExpanded && (
        <div onClick={stopPropagation}>
          {error ? (
            <div style={{ color: "#ff6b6b", marginBottom: "0.5rem" }}>
              Failed to load telemetry: {String(error)}
            </div>
          ) : null}
          <table
            id={`table-${urlToId(model.instanceURL)}`}
            className={styles.table}
          >
            <thead>
              <tr>
                <th>Unique Name</th>
                <th>Workload Type</th>
                <th>Config</th>
                <th>Inputs</th>
                <th>Outputs</th>
                <th>Workload Duration (ms)</th>
                <th>Actual Period (ms)</th>
                <th>Goal Period (ms)</th>
                <th>Budget Usage %</th>
              </tr>
            </thead>
            <tbody>
              {workloads.map((w) => (
                <TelemetryWorkload
                  key={w.name}
                  w={w}
                  telemetryBaseUrl={model.instanceURL}
                  modelName={model.modelName}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
