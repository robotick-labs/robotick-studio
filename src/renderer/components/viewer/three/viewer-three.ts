import { ViewerWorld } from "./viewer-three-world";
import type { ViewerConfig } from "../viewer-schema";

// Extend the global `window` object to expose `world`
declare global {
  interface Window {
    world?: ViewerWorld;
  }
}

let worldInstance: ViewerWorld | null = null;
let lastContainer: HTMLElement | null = null;

async function init(viewerConfig: ViewerConfig): Promise<void> {
  const container =
    viewerConfig.container ??
    (document.getElementById("viewer-container") ?? null);
  if (!container) {
    console.warn("[three-js] No viewer container available");
    return;
  }
  viewerConfig.container = container;

  const world = new ViewerWorld(viewerConfig);
  await world.start();
  worldInstance = world;
  window.world = world;
  lastContainer = container;
}

async function uninit(): Promise<void> {
  if (worldInstance) {
    worldInstance.dispose();
    worldInstance = null;
  }
  if (window.world) {
    delete window.world;
  }
  if (lastContainer) {
    lastContainer.innerHTML = "";
    lastContainer = null;
  }
}

export default { init, uninit };
