import { ViewerWorld } from "./viewer-three-world";
import type { ViewerConfig } from "../viewer-schema";

// Extend the global `window` object to expose `world`
declare global {
  interface Window {
    world?: ViewerWorld;
  }
}

let worldInstance: ViewerWorld | null = null;

async function init(viewerConfig: ViewerConfig): Promise<void> {
  // Fill in container dynamically, if not provided
  viewerConfig.container = document.getElementById("viewer-container");

  const world = new ViewerWorld(viewerConfig);
  await world.start();
  worldInstance = world;
  window.world = world;
}

async function uninit(): Promise<void> {
  if (worldInstance) {
    worldInstance.dispose();
    worldInstance = null;
  }
  if (window.world) {
    delete window.world;
  }
  const container = document.getElementById("viewer-container");
  if (container) {
    container.innerHTML = "";
  }
}

export default { init, uninit };
