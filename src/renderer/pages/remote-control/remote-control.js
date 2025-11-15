// remote_control.js

import remoteControls from "../../components/remote-controls.js";
import viewer from "../../components/viewer/viewer.js";
import * as RcSubtitles from "../../components/rc-subtitles.js";
import * as RcTelemetry from "../../components/rc-telemetry";
import currentProject from "../../core/current-project.js";

export function init() {
  // show basic telemetry if we're Pip.e (temp measure - we need to add a setting for this really)
  {
    const projectPath = currentProject.getProjectPath();
    if (projectPath.includes("pip-e")) {
      RcSubtitles.init();
      RcTelemetry.init();
    }
  }

  remoteControls.init();
  loadAndInitAsync(); // fire and forget
}

export function uninit() {
  remoteControls.uninit();
  RcSubtitles.uninit();
  RcTelemetry.uninit();
  viewer.uninit();
}

async function loadAndInitAsync() {
  const projectPath = currentProject.getProjectPath();

  let config = {};
  try {
    config = await fetchRCSettings(projectPath);
  } catch (err) {
    console.warn("Failed to load RC settings:", err);
    return;
  }

  const viewerConfig = config?.viewer;
  if (viewerConfig && typeof viewerConfig.viewerType === "string") {
    try {
      viewer.init(viewerConfig);
    } catch (err) {
      console.warn("Viewer init failed:", err);
    }
  } else {
    console.warn("No valid viewer config found in RC settings");
  }
}

async function fetchRCSettings(projectPath) {
  const url = `http://localhost:7081/query/get-project-rc-settings?project_path=${encodeURIComponent(
    projectPath
  )}`;

  const res = await fetch(url);
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
