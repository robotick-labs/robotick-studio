import { ViewerWorld } from "./viewer-three-world.js";

async function init(viewerConfig) {
  console.log(viewerConfig);

  viewerConfig.container = document.getElementById("viewer-container");
  const world = new ViewerWorld(viewerConfig);
  await world.start();
  // Expose to console
  window.world = world;
}

async function uninit() {
  // stub
}

export default { init, uninit };
