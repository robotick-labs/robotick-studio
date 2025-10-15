import viewerCesium from "./cesium/viewer-cesium.js";
import viewerThree from "./three/viewer-three.js";

import currentProject from "/js/core/current-project.js";

function init() {
  const current = currentProject.getProjectPath();

  if (current.includes("rocket")) {
    viewerCesium.init();
  } else {
    viewerThree.init();
  }
}

function uninit() {
  if (current.includes("rocket")) {
    viewerCesium.uninit();
  } else {
    viewerThree.uninit();
  }
}

export default { init, uninit };
