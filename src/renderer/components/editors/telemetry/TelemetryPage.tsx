import React from "react";
import { TelemetryApp } from "./view/TelemetryApp";
import styles from "./Telemetry.module.css";

export default function TelemetryPage() {
  return (
    <div className={styles.container}>
      <h2>Workload Telemetry</h2>
      <div className={styles.tableContainer}>
        <TelemetryApp />
      </div>
    </div>
  );
}
