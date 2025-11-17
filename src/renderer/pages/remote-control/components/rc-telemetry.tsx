// rc-telemetry.tsx
// Robotick Hub overlay for live telemetry JSON (Mind Test Outputs)

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import {
  fetchLayout,
  fetchRaw,
  createTelemetryModel,
} from "../../telemetry/document/telemetry-client";

const TELEMETRY_BASE_URL = "http://localhost:7091";
const TELEMETRY_WORKLOAD_ID = "rsc_mind_test";

let root: ReactDOM.Root | null = null;
let intervalId: number | null = null;

// Recursively build a nested JSON object from workload outputs
function buildNestedFromStruct(struct: any): any {
  if (!struct || !struct.fields) return {};

  const result: any = {};
  for (const f of struct.fields) {
    if (f.fields && f.fields.length > 0) {
      result[f.name] = buildNestedFromStruct(f);
    } else {
      const value = f.getValue?.();
      result[f.name] = value;
    }
  }
  return result;
}

function RcTelemetryView() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cachedLayout: any | null = null;
    let telemetryModel: any | null = null;

    async function poll() {
      try {
        // 1) Fetch layout once
        if (!cachedLayout) {
          cachedLayout = await fetchLayout(TELEMETRY_BASE_URL);
          if (!cachedLayout) return;
          telemetryModel = createTelemetryModel(cachedLayout);
        }

        // 2) Fetch raw buffer only each frame
        const { raw: raw } = await fetchRaw(TELEMETRY_BASE_URL);
        if (!raw) return;
        telemetryModel.raw = raw;

        // 3) Locate target workload
        const workload = telemetryModel.workloads.find(
          (w: any) => w.name === TELEMETRY_WORKLOAD_ID
        );
        if (!workload || !workload.outputs) return;

        // 4) Recursively nest outputs
        const nested = buildNestedFromStruct(workload.outputs);

        setData(nested);
        setError(null);
      } catch (err: any) {
        setError(err.message || "Fetch failed");
      }
    }

    poll();
    intervalId = window.setInterval(poll, 100); // 10 Hz
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
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
