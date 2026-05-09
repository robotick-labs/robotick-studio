import React, { useEffect, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement | null>(null);
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
  const [isPanning, setIsPanning] = useState(false);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("telemetry-model-sort", modelSortKey);
    } catch {
      // ignore storage failures so UI keeps working
    }
  }, [modelSortKey]);

  const finishPan = () => {
    panStateRef.current = null;
    setIsPanning(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 2) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    event.preventDefault();
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    setIsPanning(true);
    container.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    const container = containerRef.current;
    if (!panState || !container || panState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    container.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
    container.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    const container = containerRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }
    if (container?.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
    finishPan();
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (container?.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
    finishPan();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  return (
    <div
      ref={containerRef}
      className={isPanning ? `${styles.container} ${styles.containerPanning}` : styles.container}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={handleContextMenu}
    >
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
