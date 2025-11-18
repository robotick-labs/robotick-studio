import React from "react";
import { TelemetryApp } from "./view/TelemetryApp";
import styles from "./Telemetry.module.css";

export default function TelemetryPage() {
  return (
    <div className={styles.container}>
      <h2>Workload Telemetry</h2>

      {/* This container must exist exactly like this,
          because TelemetryApp renders into it. */}
      <div className={styles.tableContainer}>
        <TelemetryApp />
      </div>
    </div>
  );
}
