// rc-telemetry.tsx
// Robotick Hub overlay for live telemetry JSON (Mind Test Outputs)

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

const TELEMETRY_URL =
  "http://localhost:7091/api/telemetry/workload/outputs?name=rsc_mind_test";

let root: ReactDOM.Root | null = null;
let intervalId: number | null = null;

function RcTelemetryView() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(TELEMETRY_URL);
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        setData(json);
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
