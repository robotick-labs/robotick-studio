import { ViewerWorld } from "./viewer-three-world.js";

async function init() {
  const response = await fetch("config/pip_e_viewer_config.json", {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Failed to load config: ${response.statusText}`);
  const config = await response.json();
  config.container = document.getElementById("viewer-container");
  const world = new ViewerWorld(config);
  await world.start();
  // Expose to console
  window.world = world;
}

async function uninit() {
  // stub
}

export default { init, uninit };
