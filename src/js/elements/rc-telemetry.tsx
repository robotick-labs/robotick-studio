// rc-telemetry.tsx
// Robotick Hub overlay for live telemetry JSON (Mind Test Outputs)

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import { getWorkloadOutputFields } from "../pages/telemetry/telemetry-client";

const TELEMETRY_BASE_URL = "http://localhost:7091";
const TELEMETRY_WORKLOAD_ID = "rsc_mind_test";

let root: ReactDOM.Root | null = null;
let intervalId: number | null = null;

function RcTelemetryView() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const data = await getWorkloadOutputFields(
          TELEMETRY_BASE_URL,
          TELEMETRY_WORKLOAD_ID
        );
        if (!data?.outputs) {
          return; // empty — nothing to do
        }
        setData(data.outputs);
        setError(null);
      } catch (err: any) {
        setError(err.message || "Fetch failed");
      }
    }

    poll();
    intervalId = window.setInterval(poll, 100); // safe 10 Hz polling
    return () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    };
  }, []);

  return (
    <div className="rc-telemetry-overlay">
      <div className="rc-telemetry-header">Mind Test Outputs</div>
      {error ? (
        <div className="rc-telemetry-error">⚠️ {error}</div>
      ) : (
        <pre className="rc-telemetry-pre">
          {data ? JSON.stringify(data, null, 2) : "Loading..."}
        </pre>
      )}
    </div>
  );
}

function mountReact(container: HTMLElement) {
  if (!root) {
    root = ReactDOM.createRoot(container);
    root.render(<RcTelemetryView />);
  }
}

function unmountReact() {
  if (root) {
    root.unmount();
    root = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/** Called by page manager */
export function init() {
  console.log("RC Telemetry page initialized");

  // Reuse the same app container as other page modules
  const content = document.getElementById("rc-ui");
  if (!content) {
    console.error("No rc-ui container found.");
    return;
  }

  // Ensure our container exists
  let container = document.getElementById("rc-telemetry-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "rc-telemetry-container";
    content.appendChild(container);
  }

  mountReact(container);
}

export function uninit() {
  console.log("RC Telemetry page uninitializing");

  unmountReact();

  const container = document.getElementById("rc-telemetry-container");
  if (container && container.parentElement) {
    container.parentElement.removeChild(container);
  }
}
