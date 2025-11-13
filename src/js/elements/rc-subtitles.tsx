// rc-subtitles.tsx
// Robotick Hub overlay: bottom-of-screen subtitles from rsc_mind_test outputs

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import {
  decodeTelemetry,
  getWorkloadOutputFields,
} from "../pages/telemetry/telemetry-client";

const TELEMETRY_BASE_URL = "http://localhost:7091";
const TELEMETRY_WORKLOAD_ID = "rsc_mind_test";

let root: ReactDOM.Root | null = null;
let intervalId: number | null = null;

// -------------------------------------------------------------

function extractSubtitleFromFields(fields: any[]): string {
  if (!fields) return "";

  // Look for known path endings
  const f =
    fields.find((x) => x.path.endsWith("script.thought_text")) ||
    fields.find((x) => x.path.endsWith("script.text")) ||
    fields.find((x) => x.path.includes("thought"));

  if (!f) return "";
  const v = f.value;
  return typeof v === "string" ? v : "";
}

// -------------------------------------------------------------

function normalizeForDisplay(s: string): string {
  const trimmed = s.replace(/\r/g, "").trim();
  return trimmed.replace(/[ \t]{2,}/g, " ");
}

// -------------------------------------------------------------

function SubtitlesView() {
  const [subtitle, setSubtitle] = useState<string>("");
  const [visible, setVisible] = useState<boolean>(false);
  const [animateKey, setAnimateKey] = useState<number>(0);
  const lastTextRef = useRef<string>("");

  const safeSubtitle = useMemo(() => normalizeForDisplay(subtitle), [subtitle]);

  useEffect(() => {
    async function poll() {
      try {
        // 1) Fetch layout + raw
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

        // 2) Decode whole model
        const decoded = decodeTelemetry(layout, raw);

        // 3) Flat list of leaf output fields
        const fields = getWorkloadOutputFields(decoded, TELEMETRY_WORKLOAD_ID);

        // 4) Extract subtitle text
        const text = extractSubtitleFromFields(fields);
        if (typeof text !== "string" || text === "") {
          return;
        }

        const norm = normalizeForDisplay(text);
        if (norm !== lastTextRef.current) {
          lastTextRef.current = norm;
          setSubtitle(norm);
          setVisible(true);
          setAnimateKey((x) => (x + 1) % Number.MAX_SAFE_INTEGER);
        }
      } catch {
        // ignore temporary network / decode errors
      }
    }

    poll();
    intervalId = window.setInterval(poll, 100); // 10 Hz
    return () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    };
  }, []);

  return (
    <div className="subtitles-overlay" aria-live="polite" aria-atomic="true">
      <div
        key={animateKey}
        className={`subtitles-bubble ${
          visible && safeSubtitle ? "show" : "hide"
        }`}
      >
        {safeSubtitle.split("\n").map((line, idx, arr) => (
          <span className="subtitles-line" key={idx}>
            {line}
            {idx < arr.length - 1 ? <br /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------

function mountReact(container: HTMLElement) {
  if (!root) {
    root = ReactDOM.createRoot(container);
    root.render(<SubtitlesView />);
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

  let container = document.getElementById("rc-subtitles-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "rc-subtitles-container";
    content.appendChild(container);
  }

  mountReact(container);
}

export function uninit() {
  unmountReact();

  const container = document.getElementById("rc-subtitles-container");
  if (container && container.parentElement) {
    container.parentElement.removeChild(container);
  }
}
