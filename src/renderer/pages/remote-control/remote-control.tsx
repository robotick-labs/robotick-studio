// src/renderer/pages/remote-control/remote-control.tsx

import React, { useEffect, useMemo } from "react";
import viewer from "../../components/viewer/viewer";
import { RcSubtitlesOverlay } from "./components/rc-subtitles";
import { RcTelemetryOverlay } from "./components/rc-telemetry";
import RemoteControlsPanel from "./components/RemoteControlsPanel";
import { useProjectContext } from "../../core/project-context";
import { HUB_API_BASE } from "../../core/config";
import { buildUrl, fetchJSON } from "../../core/http";

export default function RemoteControlPage() {
  const { projectPath } = useProjectContext();

  useEffect(() => {
    if (!projectPath) return;
    const abortController = new AbortController();
    initRemoteControl(projectPath, abortController.signal);

    return () => {
      abortController.abort();
      cleanupRemoteControl();
    };
  }, [projectPath]);

  const showOverlays = useMemo(
    () => Boolean(projectPath && projectPath.includes("pip-e")),
    [projectPath]
  );

  if (!projectPath) {
    return (
      <div className="rc-ui">
        <p style={{ padding: "1rem" }}>Select a project to begin.</p>
      </div>
    );
  }

  return (
    <div id="rc-ui" className="rc-ui">
      <div id="viewer-container" className="viewer-container" />
      <RemoteControlsPanel />
      {showOverlays ? (
        <>
          <RcSubtitlesOverlay />
          <RcTelemetryOverlay />
        </>
      ) : null}
    </div>
  );
}

function initRemoteControl(projectPath: string, signal: AbortSignal) {
  loadViewerConfig(projectPath, signal);
}

function cleanupRemoteControl() {
  viewer.uninit();
}

async function loadViewerConfig(projectPath: string, signal: AbortSignal) {
  if (!projectPath) return;
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
  const url = buildUrl(HUB_API_BASE, "/query/get-project-rc-settings", {
    project_path: projectPath,
  });
  return await fetchJSON<Record<string, unknown>>(url, { signal });
}
