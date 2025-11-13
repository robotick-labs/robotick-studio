// subtitles.tsx
// Robotick Hub overlay: bottom-of-screen subtitles from rsc_mind_test outputs
// Shows white text on a clear-black background, like TV/movie subtitles.

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import {
  fetchLayout,
  fetchRaw,
  createTelemetryModel,
} from "../pages/telemetry/document/telemetry-client";

const TELEMETRY_BASE_URL = "http://localhost:7091";
const TELEMETRY_WORKLOAD_ID = "rsc_mind_test";
const FIELD_PATH = `${TELEMETRY_WORKLOAD_ID}.outputs.script.thought_text`;

let root: ReactDOM.Root | null = null;
let intervalId: number | null = null;

// -------------------------------------------------------------
// Subtitle extraction (fixed path)
// -------------------------------------------------------------
function extractSubtitleText(decoded: any): string {
  if (!decoded || !decoded.getField) return "";
  const field = decoded.getField(FIELD_PATH);
  if (!field) return "";
  const value = field.getValue?.();
  return typeof value === "string" ? value : "";
}

// -------------------------------------------------------------
function normalizeForDisplay(s: string): string {
  // Trim, collapse excessive whitespace, keep intentional newlines
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
    let cachedLayout: any | null = null;
    let decoded: any | null = null;

    async function poll() {
      try {
        // Fetch layout once
        if (!cachedLayout) {
          cachedLayout = await fetchLayout(TELEMETRY_BASE_URL);
          if (!cachedLayout) return;
          decoded = createTelemetryModel(cachedLayout);
        }

        // Fetch raw buffer per frame
        const { raw: raw } = await fetchRaw(TELEMETRY_BASE_URL);
        if (!raw) return;
        decoded.raw = raw;

        // Extract and normalise
        const text = extractSubtitleText(decoded);
        if (!text) return;

        const normalized = normalizeForDisplay(text);
        if (normalized !== lastTextRef.current) {
          lastTextRef.current = normalized;
          setSubtitle(normalized);
          setVisible(true);
          setAnimateKey((k) => (k + 1) % Number.MAX_SAFE_INTEGER);
        }
      } catch {
        // ignore transient network/decode errors
      }
    }

    // Prime + poll ~10 Hz (100 ms)
    poll();
    intervalId = window.setInterval(poll, 100);
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
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
        {/* Preserve intended newlines */}
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

/** Called by page manager */
export function init() {
  console.log("Subtitles overlay initialized");

  const content = document.getElementById("rc-ui");
  if (!content) {
    console.error("No rc-ui container found.");
    return;
  }

  let container = document.getElementById("rc-subtitles-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "rc-subtitles-container";
    content.appendChild(container);
  }

  mountReact(container);
}

export function uninit() {
  console.log("Subtitles overlay uninitializing");

  unmountReact();

  const container = document.getElementById("rc-subtitles-container");
  if (container && container.parentElement) {
    container.parentElement.removeChild(container);
  }
}
