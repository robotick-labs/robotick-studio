// src/js/pages/telemetry/telemetry.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { TelemetryApp } from "./TelemetryApp";

let root: ReactDOM.Root | null = null;

export function init() {
  const container = document.querySelector(".telemetry-table-container");
  if (!container) {
    console.error("No .telemetry-table-container found to mount React app.");
    return;
  }
  root = ReactDOM.createRoot(container);
  root.render(<TelemetryApp />);
}

export function uninit() {
  if (root) {
    root.unmount();
    root = null;
  }
}
