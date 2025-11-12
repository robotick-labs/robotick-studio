// subtitles.tsx
// Robotick Hub overlay: bottom-of-screen subtitles from rsc_mind_test outputs
// Shows white text on a clear-black background, like TV/movie subtitles.

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import { getWorkloadOutputFields } from "../pages/telemetry/telemetry-client";

const TELEMETRY_BASE_URL = "http://localhost:7091";
const TELEMETRY_WORKLOAD_ID = "rsc_mind_test";

let root: ReactDOM.Root | null = null;
let intervalId: number | null = null;

function extractSubtitleText(json: any): string {
  if (!json) return "";
  // Support both nested and dotted key styles
  const nested = json?.script?.thought_text;
  if (typeof nested === "string") return nested;

  const dotted = json["script.thought_text"];
  if (typeof dotted === "string") return dotted;

  // Some payloads may wrap outputs under a key
  const outputs = json?.outputs ?? json?.data ?? null;
  if (outputs) {
    const oNested = outputs?.script?.thought_text;
    if (typeof oNested === "string") return oNested;
    const oDotted = outputs["script.thought_text"];
    if (typeof oDotted === "string") return oDotted;
  }

  return "";
}

function normalizeForDisplay(s: string): string {
  // Trim, collapse excessive whitespace, keep intentional newlines
  const trimmed = s.replace(/\r/g, "").trim();
  // Avoid collapsing single newlines that indicate manual line breaks
  return trimmed.replace(/[ \t]{2,}/g, " ");
}

function SubtitlesView() {
  const [subtitle, setSubtitle] = useState<string>("");
  const [visible, setVisible] = useState<boolean>(false);
  const [animateKey, setAnimateKey] = useState<number>(0);
  const lastTextRef = useRef<string>("");

  // Treat HTML special chars as text; React escapes by default.
  const safeSubtitle = useMemo(() => normalizeForDisplay(subtitle), [subtitle]);

  useEffect(() => {
    async function poll() {
      try {
        const workload = await getWorkloadOutputFields(
          TELEMETRY_BASE_URL,
          TELEMETRY_WORKLOAD_ID
        );

        const text = workload?.outputs?.script?.thought_text;
        if (typeof text !== "string" || text === "") {
          return; // nothing to display
        }

        const normalized = normalizeForDisplay(text);
        if (normalized !== lastTextRef.current) {
          lastTextRef.current = normalized;
          setSubtitle(normalized);
          setVisible(true);
          // retrigger CSS animation
          setAnimateKey((key) => (key + 1) % Number.MAX_SAFE_INTEGER);
        }
      } catch {
        // ignore transient network or decoding errors
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
        {safeSubtitle.split("\n").map((line, idx) => (
          <span className="subtitles-line" key={idx}>
            {line}
            {idx < safeSubtitle.split("\n").length - 1 ? <br /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

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

  // Reuse the same app container as other page modules
  const content = document.getElementById("rc-ui");
  if (!content) {
    console.error("No rc-ui container found.");
    return;
  }

  // Ensure our container exists
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
