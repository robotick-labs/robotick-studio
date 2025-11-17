import React from "react";
import { TelemetryApp } from "./view/TelemetryApp";

export default function TelemetryPage() {
  return (
    <div className="telemetry-container">
      <h2>Workload Telemetry</h2>

      {/* This container must exist exactly like this,
          because TelemetryApp renders into it. */}
      <div className="telemetry-table-container">
        <TelemetryApp />
      </div>
    </div>
  );
}
