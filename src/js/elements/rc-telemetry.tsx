// rc-telemetry.tsx
// Robotick Hub overlay for live telemetry JSON (Mind Test Outputs)

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import {
  decodeTelemetry,
  getWorkloadOutputFields,
} from "../pages/telemetry/telemetry-client";

const TELEMETRY_BASE_URL = "http://localhost:7091";
const TELEMETRY_WORKLOAD_ID = "rsc_mind_test";

let root: ReactDOM.Root | null = null;
let intervalId: number | null = null;

// Convert "a.b.c" → nested objects { a:{ b:{ c:value }}}
function nestify(fields: any[]): any {
  const root: any = {};
  for (const f of fields) {
    const parts = f.path.split(".");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p]) cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = f.value;
  }
  return root;
}

function RcTelemetryView() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        // 1) Fetch & decode
        const layout = await (
          await fetch(
            `${TELEMETRY_BASE_URL}/api/telemetry/workloads_buffer/layout`
          )
        ).json();
        const raw = await (
          await fetch(
            `${TELEMETRY_BASE_URL}/api/telemetry/workloads_buffer/raw`
          )
        ).arrayBuffer();
        const decoded = decodeTelemetry(layout, raw);

        // 2) Flat leaf outputs
        const fields = getWorkloadOutputFields(decoded, TELEMETRY_WORKLOAD_ID);
        if (!fields.length) return;

        // 3) Nest for clean JSON printing
        const nested = nestify(fields);

        setData(nested);
        setError(null);
      } catch (err: any) {
        setError(err.message || "Fetch failed");
      }
    }

    poll();
    intervalId = window.setInterval(poll, 100);
    return () => {
      if (intervalId) clearInterval(intervalId);
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

// -------------------------------------------------------------

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

export function init() {
  const content = document.getElementById("rc-ui");
  if (!content) return;

  let container = document.getElementById("rc-telemetry-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "rc-telemetry-container";
    content.appendChild(container);
  }

  mountReact(container);
}

export function uninit() {
  unmountReact();

  const container = document.getElementById("rc-telemetry-container");
  if (container && container.parentElement) {
    container.parentElement.removeChild(container);
  }
}
