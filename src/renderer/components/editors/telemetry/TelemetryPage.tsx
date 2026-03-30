import React, { useEffect, useState } from "react";
import { TelemetryApp } from "./view/TelemetryApp";
import styles from "./Telemetry.module.css";
import type { ModelSortKey } from "./view/TelemetryApp";

const MODEL_SORT_OPTIONS: ReadonlyArray<{
  value: ModelSortKey;
  label: string;
}> = [
  { value: "telemetry_port", label: "Telemetry Port" },
  { value: "model_name", label: "Model Name" },
  { value: "model_path", label: "Model Path" },
  { value: "memory_process", label: "Memory - Process" },
  { value: "memory_workloads", label: "Memory - Workloads" },
];

export default function TelemetryPage() {
  const [modelSortKey, setModelSortKey] = useState<ModelSortKey>(() => {
    try {
      const saved = localStorage.getItem("telemetry-model-sort");
      if (
        saved === "telemetry_port" ||
        saved === "model_name" ||
        saved === "model_path" ||
        saved === "memory_process" ||
        saved === "memory_workloads"
      ) {
        return saved;
      }
    } catch {
      // ignore storage failures so UI keeps working
    }
    return "telemetry_port";
  });

  useEffect(() => {
    try {
      localStorage.setItem("telemetry-model-sort", modelSortKey);
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [modelSortKey]);

  return (
    <div className={styles.container}>
      <div className={styles.panelHeaderRow}>
        <h2>Workload Telemetry</h2>
        <label className={styles.panelHeaderControlLabel}>
          Sort models by:
          <select
            id="telemetry-model-sort"
            className={styles.panelHeaderControlSelect}
            value={modelSortKey}
            onChange={(e) => setModelSortKey(e.target.value as ModelSortKey)}
          >
            {MODEL_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.tableContainer}>
        <TelemetryApp modelSortKey={modelSortKey} />
      </div>
    </div>
  );
}
