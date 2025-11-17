// src/renderer/pages/remote-control/remote-control.tsx

import React, { useEffect } from "react";
import remoteControls from "../../components/remote-controls.js";
import viewer from "../../components/viewer/viewer.js";
import * as RcSubtitles from "../../components/rc-subtitles.js";
import * as RcTelemetry from "../../components/rc-telemetry";
import currentProject from "../../core/current-project.js";

export default function RemoteControlPage() {
  useEffect(() => {
    const abortController = new AbortController();
    initRemoteControl(abortController.signal);

    return () => {
      abortController.abort();
      cleanupRemoteControl();
    };
  }, []);

  return (
    <div id="rc-ui" className="rc-ui">
      <div id="viewer-container" className="viewer-container" />

      <div className="joystick-row">
        <div id="left-area" className="stick-area">
          <div id="left-knob" className="knob" />
        </div>
        <div id="right-area" className="stick-area">
          <div id="right-knob" className="knob" />
        </div>
      </div>

      <div className="controls">
        <button id="takeover-button" className="toggle-button active">
          TAKEOVER
        </button>

        {/*
        <div className="slider-group">
          <label>Left Deadzone</label><br />
          <label>X</label>
          <input type="range" min="0" max="0.5" step="0.01" id="deadzone-left-x" />
          <label>Y</label>
          <input type="range" min="0" max="0.5" step="0.01" id="deadzone-left-y" />
        </div>

        <div className="slider-group">
          <label>Right Deadzone</label><br />
          <label>X</label>
          <input type="range" min="0" max="0.5" step="0.01" id="deadzone-right-x" />
          <label>Y</label>
          <input type="range" min="0" max="0.5" step="0.01" id="deadzone-right-y" />
        </div>
        */}
      </div>
    </div>
  );
}

function initRemoteControl(signal: AbortSignal) {
  const projectPath = currentProject.getProjectPath();

  if (projectPath?.includes("pip-e")) {
    RcSubtitles.init();
    RcTelemetry.init();
  }

  remoteControls.init();
  loadViewerConfig(projectPath, signal);
}

function cleanupRemoteControl() {
  remoteControls.uninit();
  RcSubtitles.uninit();
  RcTelemetry.uninit();
  viewer.uninit();
}

async function loadViewerConfig(projectPath: string, signal: AbortSignal) {
  let config: Record<string, unknown> = {};

  try {
    config = await fetchRCSettings(projectPath, signal);
  } catch (err) {
    if (signal.aborted) return;
    console.warn("Failed to load RC settings:", err);
    return;
  }

  if (signal.aborted) {
    return;
  }

  const viewerConfig = (config as { viewer?: unknown })?.viewer;
  if (
    viewerConfig &&
    typeof viewerConfig === "object" &&
    typeof (viewerConfig as { viewerType?: unknown }).viewerType === "string"
  ) {
    try {
      viewer.init(viewerConfig);
    } catch (err) {
      console.warn("Viewer init failed:", err);
    }
  } else {
    console.warn("No valid viewer config found in RC settings");
  }
}

async function fetchRCSettings(projectPath: string, signal: AbortSignal) {
  const url = `http://localhost:7081/query/get-project-rc-settings?project_path=${encodeURIComponent(
    projectPath
  )}`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch project-rc settings: ${res.status} ${res.statusText}`
    );
  }

  const json = await res.json();
  if (typeof json !== "object" || json === null) {
    throw new Error("Invalid JSON received");
  }

  return json;
}
