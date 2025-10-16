// remote_control.js

import remoteControls from "/js/elements/remote-controls.js";
import viewer from "/js/elements/viewer/viewer.js";
import currentProject from "/js/core/current-project.js";

export function init() {
  remoteControls.init();
  loadAndInitAsync(); // fire and forget
}

export function uninit() {
  remoteControls.uninit();
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
