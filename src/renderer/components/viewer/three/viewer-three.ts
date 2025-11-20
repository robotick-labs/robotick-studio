import { ViewerWorld } from "./viewer-three-world";
import type { ViewerConfig } from "../viewer-schema";

// Extend the global `window` object to expose `world`
declare global {
  interface Window {
    world?: ViewerWorld;
  }
}

const worlds = new Map<number, ViewerWorld>();

async function init(viewerConfig: ViewerConfig, instanceId: number): Promise<void> {
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
  worlds.set(instanceId, world);
  window.world = world;
}

async function uninit(instanceId?: number): Promise<void> {
  if (typeof instanceId === "number") {
    const world = worlds.get(instanceId);
    if (!world) return;
    world.dispose();
    worlds.delete(instanceId);
    if (window.world === world) {
      delete window.world;
    }
    return;
  }

  for (const world of worlds.values()) {
    world.dispose();
  }
  worlds.clear();
  if (window.world) {
    delete window.world;
  }
}

export default { init, uninit };
