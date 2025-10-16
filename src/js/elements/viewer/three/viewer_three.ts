import { ViewerWorld } from "./viewer_three_world.js";
import type { WorldConfig } from "../viewer_schema.js";

async function main() {
  const response = await fetch("config/pip_e_viewer_config.json", {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Failed to load config: ${response.statusText}`);
  const config = (await response.json()) as WorldConfig;

  const world = new ViewerWorld(config);
  await world.start();

  // Expose to console
  (window as any).world = world;
}

main().catch(console.error);
