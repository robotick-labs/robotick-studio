import { ViewerWorld } from "./viewer-three-world"; // :-)
import type { ViewerConfig } from "../viewer-schema";

// Extend the global `window` object to expose `world`
declare global {
  interface Window {
    world?: ViewerWorld;
  }
}

async function init(viewerConfig: ViewerConfig): Promise<void> {
  console.log(viewerConfig);

  // Fill in container dynamically, if not provided
  viewerConfig.container = document.getElementById("viewer-containner");

  const world = new ViewerWorld(viewerConfig);
  await world.start();

  window.world = world;
}

async function uninit(): Promise<void> {
  // placeholder
}

export default { init, uninit };
